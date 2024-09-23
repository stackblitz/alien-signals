import { DirtyLevels, activeTrackers, cleanupDepEffect, depsMap, pauseTracking, resetTracking } from './system';

export type TrackToken = WeakRef<Tracker> | Tracker;

export class Tracker {

	trackToken?: TrackToken;
	dirtyLevel = DirtyLevels.Dirty;
	shouldSpreadEffect = false;
	trackId = 0;
	runnings = 0;
	depsLength = 0;

	constructor(
		public spread: () => void,
		public effect?: () => void,
	) { }

	get dirty() {
		while (this.dirtyLevel === DirtyLevels.MaybeDirty) {
			this.dirtyLevel = DirtyLevels.QueryingDirty;
			if (this.trackToken) {
				const deps = depsMap.get(this.trackToken);
				if (deps) {
					pauseTracking();
					for (const dep of deps) {
						dep.computed?.();
						if (this.dirtyLevel >= DirtyLevels.Dirty) {
							break;
						}
					}
					resetTracking();
				}
			}
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

	deref() {
		return this;
	}
}

function preCleanup(tracker: Tracker) {
	tracker.trackId++;
	tracker.depsLength = 0;
}

function postCleanup(tracker: Tracker) {
	if (tracker.trackToken) {
		const deps = depsMap.get(tracker.trackToken);
		if (deps && deps.length > tracker.depsLength) {
			for (let i = tracker.depsLength; i < deps.length; i++) {
				cleanupDepEffect(deps[i], tracker);
			}
			deps.length = tracker.depsLength;
		}
	}
}
