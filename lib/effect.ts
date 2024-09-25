import { Subscriber } from './system';

export class EffectScope {
	effects = new Set<Effect>();

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
		for (const effect of [...this.effects]) {
			effect.stop();
		}
	}
}

export let currentEffectScope = new EffectScope();

export class Effect {
	private sub = new Subscriber(undefined, this);
	private scope = currentEffectScope;

	constructor(
		private fn: () => void
	) {
		const prevSub = this.sub.trackStart();
		fn();
		this.sub.trackEnd(prevSub);
		this.scope.effects.add(this);
	}

	run() {
		if (this.sub.isDirty()) {
			const prevSub = this.sub.trackStart();
			this.fn();
			this.sub.trackEnd(prevSub);
		}
	}

	stop() {
		this.sub.preTrack();
		this.sub.postTrack();
		this.scope.effects.delete(this);
	}
}

export function effect(fn: () => void) {
	return new Effect(fn);
}

export function effectScope() {
	return new EffectScope();
}
