import type { Subs } from './subs';
import type { Tracker, TrackToken } from './tracker';

export const enum DirtyLevels {
	NotDirty,
	QueryingDirty,
	MaybeDirty,
	Dirty,
}

export let activeTrackers: Tracker[] = [];

let pauseEffectStack = 0;

const pausedTrackers: Tracker[][] = [];
const pendingEffects: (() => void)[] = [];

export function pauseTracking() {
	pausedTrackers.push(activeTrackers);
	activeTrackers = [];
}

export function resetTracking() {
	activeTrackers = pausedTrackers.pop()!;
}

export function pauseEffect() {
	pauseEffectStack++;
}

export function resetEffect() {
	pauseEffectStack--;
	while (!pauseEffectStack && pendingEffects.length) {
		pendingEffects.shift()!();
	}
}

export const subsListMap = new WeakMap<TrackToken, Subs[]>();

const trackerRegistry = new FinalizationRegistry<WeakRef<Tracker>>(trackToken => {
	const subsList = subsListMap.get(trackToken);
	if (subsList) {
		for (const subs of subsList) {
			subs.delete(trackToken);
		}
		subsList.length = 0;
	}
});

export function track(subs: Subs) {
	if (activeTrackers.length) {
		const tracker = activeTrackers[activeTrackers.length - 1];
		if (!tracker.trackToken) {
			if (tracker.effect) {
				tracker.trackToken = tracker;
			}
			else {
				tracker.trackToken = new WeakRef(tracker);
				trackerRegistry.register(tracker, tracker.trackToken, tracker);
			}
			subsListMap.set(tracker.trackToken, []);
		}
		const deps = subsListMap.get(tracker.trackToken);
		if (deps) {
			if (subs.get(tracker) !== tracker.version) {
				subs.set(tracker, tracker.version);
				const oldDep = deps[tracker.depsLength];
				if (oldDep !== subs) {
					if (oldDep) {
						cleanupInvalidTracker(oldDep, tracker);
					}
					deps[tracker.depsLength++] = subs;
				} else {
					tracker.depsLength++;
				}
			}
		}
	}
}

export function cleanupInvalidTracker(subs: Subs, tracker: Tracker) {
	const version = subs.get(tracker);
	if (version !== undefined && tracker.version !== version) {
		subs.delete(tracker);
	}
}

export function trigger(subs: Subs, dirtyLevel: DirtyLevels) {
	pauseEffect();
	for (const [trackToken, version] of subs.entries()) {
		const tracker = trackToken.deref();
		const tracking = version === tracker?.version;
		if (!tracking) {
			continue;
		}
		if (tracker.dirtyLevel < dirtyLevel) {
			tracker.shouldSpread ||= tracker.dirtyLevel === DirtyLevels.NotDirty;
			tracker.dirtyLevel = dirtyLevel;
		}
		if (tracker.shouldSpread) {
			tracker.shouldSpread = false;
			tracker.spread();
			if (tracker.effect) {
				pendingEffects.push(tracker.effect);
			}
		}
	}
	resetEffect();
}
