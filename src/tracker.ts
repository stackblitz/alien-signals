import { Subs } from './subs';
import { DirtyLevels, activeTrackers, cleanupInvalidTracker, pauseTracking, resetTracking } from './system';

export class Tracker {

	dirtyLevel = DirtyLevels.Dirty;
	shouldSpread = false;
	version = 0;
	runnings = 0;
	depsLength = 0;
	deps: Subs[] = [];

	constructor(
		public spread: () => void,
		public effect?: () => void,
	) { }

	get dirty() {
		while (this.dirtyLevel === DirtyLevels.MaybeDirty && this.depsLength) {
			this.dirtyLevel = DirtyLevels.QueryingDirty;
			pauseTracking();
			for (let i = 0; i < this.depsLength; i++) {
				this.deps[i].queryDirty?.();
				if (this.dirtyLevel >= DirtyLevels.Dirty) {
					break;
				}
			}
			resetTracking();
			if (this.dirtyLevel === DirtyLevels.QueryingDirty) {
				this.dirtyLevel = DirtyLevels.NotDirty;
			}
		}
		return this.dirtyLevel >= DirtyLevels.Dirty;
	}

	track<T>(fn: () => T): T {
		try {
			activeTrackers.push(this);
			this.runnings++;
			preCleanup(this);
			return fn();
		} finally {
			postCleanup(this);
			this.runnings--;
			activeTrackers.pop();
			if (!this.runnings) {
				this.dirtyLevel = DirtyLevels.NotDirty;
			}
		}
	}

	stop() {
		preCleanup(this);
		postCleanup(this);
	}
}

function preCleanup(tracker: Tracker) {
	tracker.version++;
	tracker.depsLength = 0;
}

function postCleanup(tracker: Tracker) {
	if (tracker.deps.length > tracker.depsLength) {
		for (let i = tracker.depsLength; i < tracker.deps.length; i++) {
			cleanupInvalidTracker(tracker.deps[i], tracker);
		}
		tracker.deps.length = tracker.depsLength;
	}
}
