import { postCleanup, preCleanup, track, Subscriber } from './system';

let activeScope = new Set<ReturnType<typeof effect>>();

export function effect(fn: () => void) {
	const subscriber = new Subscriber(
		() => { },
		() => {
			if (subscriber.dirty) {
				track(subscriber, fn);
			}
		});
	track(subscriber, fn);
	const effect = {
		stop() {
			preCleanup(subscriber);
			postCleanup(subscriber);
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
