import { DirtyLevels, IEffect, Subscriber } from './system';

export class EffectScope {
	effects: Effect | undefined = undefined;
	effectsTail: Effect | undefined = undefined;

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
		while (this.effects !== undefined) {
			this.effects.stop();
		}
	}

	add(effect: Effect) {
		if (this.effectsTail !== undefined) {
			this.effectsTail.nextEffect = effect;
			effect.prevEffect = this.effectsTail;
			this.effectsTail = effect;
		}
		else {
			this.effects = this.effectsTail = effect;
		}
	}

	remove(effect: Effect) {
		if (effect.prevEffect !== undefined) {
			effect.prevEffect.nextEffect = effect.nextEffect;
		}
		else {
			this.effects = effect.nextEffect;
		}
		if (effect.nextEffect !== undefined) {
			effect.nextEffect.prevEffect = effect.prevEffect;
		}
		else {
			this.effectsTail = effect.prevEffect;
		}
	}
}

export let currentEffectScope = new EffectScope();

export class Effect implements IEffect, Subscriber {
	scope = currentEffectScope;
	queuedNext = undefined;
	prevEffect: Effect | undefined = undefined;
	nextEffect: Effect | undefined = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

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
