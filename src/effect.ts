import { postCleanup, preCleanup, Tracker } from './tracker';

let activeScope = new Set<ReturnType<typeof effect>>();

export function effect(fn: () => void) {
	const tracker = new Tracker(
		() => { },
		() => {
			if (tracker.dirty) {
				tracker.track(fn);
			}
		});
	tracker.track(fn);
	const effect = {
		stop() {
			preCleanup(tracker);
			postCleanup(tracker);
			activeScope.delete(effect);
		},
	};
	activeScope.add(effect);
	return effect;
}

export function effectScope() {
	const currentScope = new Set<ReturnType<typeof effect>>();
	return {
		run<T>(fn: () => T) {
			const original = activeScope;
			try {
				activeScope = currentScope;
				return fn();
			} finally {
				activeScope = original;
			}
		},
		stop() {
			for (const effect of [...currentScope]) {
				effect.stop();
			}
		},
	};
}
