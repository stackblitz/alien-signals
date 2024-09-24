import { postTrack, preTrack, track, Subscriber } from './system';

export let currentScope = {
	effects: new Set<ReturnType<typeof effect>>(),
};

export function effect(fn: () => void) {
	const subscriber = new Subscriber(
		undefined,
		() => {
			if (subscriber.dirty) {
				track(subscriber, fn);
			}
		});
	track(subscriber, fn);
	const effect = {
		stop() {
			preTrack(subscriber);
			postTrack(subscriber);
			currentScope.effects.delete(effect);
		},
	};
	currentScope.effects.add(effect);
	return effect;
}

export function effectScope() {
	const scope: typeof currentScope = {
		effects: new Set(),
	};
	return {
		run<T>(fn: () => T) {
			const original = currentScope;
			try {
				currentScope = scope;
				return fn();
			} finally {
				currentScope = original;
			}
		},
		stop() {
			for (const effect of [...scope.effects]) {
				effect.stop();
			}
		},
	};
}
