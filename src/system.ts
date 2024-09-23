import type { Dep } from './dep';
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
const pausedEffects: (() => void)[] = [];

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
	while (!pauseEffectStack && pausedEffects.length) {
		pausedEffects.shift()!();
	}
}

export const depsMap = new WeakMap<TrackToken, Dep[]>();

const trackerRegistry = new FinalizationRegistry<WeakRef<Tracker>>(trackToken => {
	const deps = depsMap.get(trackToken);
	if (deps) {
		for (const dep of deps) {
			dep.delete(trackToken);
		}
		deps.length = 0;
	}
});

export function track(dep: Dep) {
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
			depsMap.set(tracker.trackToken, []);
		}
		const deps = depsMap.get(tracker.trackToken);
		if (deps) {
			if (dep.get(tracker) !== tracker.trackId) {
				dep.set(tracker, tracker.trackId);
				const oldDep = deps[tracker.depsLength];
				if (oldDep !== dep) {
					if (oldDep) {
						cleanupInvalidTracker(oldDep, tracker);
					}
					deps[tracker.depsLength++] = dep;
				} else {
					tracker.depsLength++;
				}
			}
		}
	}
}

export function cleanupInvalidTracker(dep: Dep, tracker: Tracker) {
	const trackId = dep.get(tracker);
	if (trackId !== undefined && tracker.trackId !== trackId) {
		dep.delete(tracker);
	}
}

export function trigger(dep: Dep, dirtyLevel: DirtyLevels) {
	pauseEffect();
	for (const [trackToken, trackId] of dep.entries()) {
		const tracker = trackToken.deref();
		const tracking = trackId === tracker?.trackId;
		if (!tracking) {
			continue;
		}
		if (tracker.dirtyLevel < dirtyLevel) {
			tracker.shouldSpreadEffect ||= tracker.dirtyLevel === DirtyLevels.NotDirty;
			tracker.dirtyLevel = dirtyLevel;
		}
		if (tracker.shouldSpreadEffect) {
			tracker.spread();
			tracker.shouldSpreadEffect = false;
			if (tracker.effect) {
				pausedEffects.push(tracker.effect);
			}
		}
	}
	resetEffect();
}
