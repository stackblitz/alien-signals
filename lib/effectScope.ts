import { Subscriber } from './system';

export let currentEffectScope: EffectScope | undefined = undefined;

export function effectScope() {
	return new EffectScope();
}

export class EffectScope {
	subs: Subscriber[] = [];

	run<T>(fn: () => T) {
		const lastEffectScope = currentEffectScope;
		try {
			currentEffectScope = this;
			return fn();
		} finally {
			currentEffectScope = lastEffectScope;
		}
	}

	stop() {
		for (const sub of this.subs) {
			Subscriber.clearTrack(sub);
		}
	}
}
