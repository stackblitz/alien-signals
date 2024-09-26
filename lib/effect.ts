import { IEffect, Subscriber } from './system';

export class EffectScope {
	effects = new Set<IEffect>();

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
		this.scope.effects.add(this);
		this.run();
	}

	run() {
		if (this.sub.isDirty()) {
			this.sub.trackStart();
			this.fn();
			this.sub.trackEnd();
		}
	}

	stop() {
		this.sub.trackStart();
		this.sub.trackEnd();
		this.scope.effects.delete(this);
	}
}

export function effect(fn: () => void) {
	return new Effect(fn);
}

export function effectScope() {
	return new EffectScope();
}
