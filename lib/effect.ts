import { DirtyLevels, IEffect, Subscriber } from './system';

export class EffectScope {
	firstEffect: Effect | null = null;
	lastEffect: Effect | null = null;

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
		while (this.firstEffect) {
			this.firstEffect.stop();
		}
	}

	add(effect: Effect) {
		if (this.lastEffect) {
			this.lastEffect.nextEffect = effect;
			effect.prevEffect = this.lastEffect;
			this.lastEffect = effect;
		}
		else {
			this.firstEffect = this.lastEffect = effect;
		}
	}

	remove(effect: Effect) {
		if (effect.prevEffect) {
			effect.prevEffect.nextEffect = effect.nextEffect;
		}
		else {
			this.firstEffect = effect.nextEffect;
		}
		if (effect.nextEffect) {
			effect.nextEffect.prevEffect = effect.prevEffect;
		}
		else {
			this.lastEffect = effect.prevEffect;
		}
	}
}

export let currentEffectScope = new EffectScope();

export class Effect implements IEffect, Subscriber {
	scope = currentEffectScope;
	queuedNext: Effect | null = null;
	prevEffect: Effect | null = null;
	nextEffect: Effect | null = null;

	// Subscriber
	firstDep = null;
	lastDep = null;
	depsLength = 0;
	dirtyLevel = DirtyLevels.Dirty;
	version = -1;

	constructor(
		private fn: () => void
	) {
		this.scope.add(this);
		this.run();
	}

	queue() {
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
		Subscriber.preTrack(this);
		Subscriber.postTrack(this);
		this.scope.remove(this);
	}
}

export function effect(fn: () => void) {
	return new Effect(fn);
}

export function effectScope() {
	return new EffectScope();
}
