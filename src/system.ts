import type { Subs } from './subs';
import type { Tracker } from './tracker';

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

function pauseSpread() {
	pauseEffectStack++;
}

function resetSpread() {
	pauseEffectStack--;
	while (!pauseEffectStack && pendingEffects.length) {
		pendingEffects.shift()!();
	}
}

export function track(subs: Subs) {
	if (activeTrackers.length) {
		const tracker = activeTrackers[activeTrackers.length - 1];
		if (subs.get(tracker) !== tracker.version) {
			subs.set(tracker, tracker.version);
			const oldDep = tracker.deps[tracker.depsLength];
			if (oldDep !== subs) {
				if (oldDep) {
					cleanupInvalidTracker(oldDep, tracker);
				}
				tracker.deps[tracker.depsLength++] = subs;
			} else {
				tracker.depsLength++;
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
	pauseSpread();
	for (const [tracker, version] of subs.entries()) {
		const tracking = version === tracker.version;
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
	resetSpread();
}

export function batch(fn: () => void) {
	pauseSpread();
	fn();
	resetSpread();
}
