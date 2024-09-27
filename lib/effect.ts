import { DirtyLevels, IEffect, Subscriber } from './system';

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

export class Effect implements IEffect, Subscriber {
	private scope = currentEffectScope;

	// Subscriber
	deps = [];
	depsLength = 0;
	dirtyLevel = DirtyLevels.Dirty;
	version = -1;

	constructor(
		private fn: () => void
	) {
		this.scope.effects.add(this);
		this.run();
	}

	run() {
		if (Subscriber.isDirty(this)) {
			const lastActiveSub = Subscriber.trackStart(this);
			this.fn();
			Subscriber.trackEnd(this, lastActiveSub);
		}
	}

	stop() {
		const lastActiveSub = Subscriber.trackStart(this);
		Subscriber.trackEnd(this, lastActiveSub);
		this.scope.effects.delete(this);
	}
}

export function effect(fn: () => void) {
	return new Effect(fn);
}

export function effectScope() {
	return new EffectScope();
}
