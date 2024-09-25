import { postTrack, preTrack, track, Subscriber } from './system';

export let currentEffectScope = {
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
			currentEffectScope.effects.delete(effect);
		},
	};
	currentEffectScope.effects.add(effect);
	return effect;
}

export function effectScope() {
	const scope: typeof currentEffectScope = {
		effects: new Set(),
	};
	return {
		run<T>(fn: () => T) {
			const original = currentEffectScope;
			try {
				currentEffectScope = scope;
				return fn();
			} finally {
				currentEffectScope = original;
			}
		},
		stop() {
			for (const effect of [...scope.effects]) {
				effect.stop();
			}
		},
	};
}
