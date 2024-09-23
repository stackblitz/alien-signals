import { Subs } from './subs';
import { DirtyLevels, activeTrackers, cleanupInvalidTracker, pauseTracking, resetTracking } from './system';

export class Tracker {

	dirtyLevel = DirtyLevels.Dirty;
	shouldSpread = false;
	version = 0;
	runnings = 0;
	subsLength = 0;
	subsList: Subs[] = [];

	constructor(
		public spread: () => void,
		public effect?: () => void,
	) { }

	get dirty() {
		while (this.dirtyLevel === DirtyLevels.MaybeDirty && this.subsList.length) {
			this.dirtyLevel = DirtyLevels.QueryingDirty;
			pauseTracking();
			for (const subs of this.subsList) {
				subs.queryDirty?.();
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
	tracker.subsLength = 0;
}

function postCleanup(tracker: Tracker) {
	if (tracker.subsList.length > tracker.subsLength) {
		for (let i = tracker.subsLength; i < tracker.subsList.length; i++) {
			cleanupInvalidTracker(tracker.subsList[i], tracker);
		}
		tracker.subsList.length = tracker.subsLength;
	}
}
