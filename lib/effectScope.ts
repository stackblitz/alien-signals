import { Subscriber } from './system';

export let currentEffectScope: EffectScope | undefined = undefined;

export class EffectScope {
	subs: Subscriber[] = [];

	run<T>(fn: () => T) {
		const original = currentEffectScope;
		try {
			currentEffectScope = this;
			return fn();
		} finally {
			currentEffectScope = original;
		}
	}

	stop() {
		for (const sub of this.subs) {
			Subscriber.clearTrack(sub);
		}
	}
}
