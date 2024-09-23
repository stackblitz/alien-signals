import { DirtyLevels, activeTrackers, cleanupInvalidTracker, subsListMap, pauseTracking, resetTracking } from './system';

export type TrackToken = WeakRef<Tracker> | Tracker;

export class Tracker {

	trackToken?: TrackToken;
	dirtyLevel = DirtyLevels.Dirty;
	shouldSpread = false;
	version = 0;
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
				const subsList = subsListMap.get(this.trackToken);
				if (subsList?.length) {
					pauseTracking();
					for (const subs of subsList) {
						subs.queryDirty?.();
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
	tracker.version++;
	tracker.depsLength = 0;
}

function postCleanup(tracker: Tracker) {
	if (tracker.trackToken) {
		const subsList = subsListMap.get(tracker.trackToken);
		if (subsList && subsList.length > tracker.depsLength) {
			for (let i = tracker.depsLength; i < subsList.length; i++) {
				cleanupInvalidTracker(subsList[i], tracker);
			}
			subsList.length = tracker.depsLength;
		}
	}
}
