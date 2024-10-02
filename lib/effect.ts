import { DirtyLevels, IEffect, Subscriber } from './system';

export class EffectScope {
	effects: Effect | undefined = undefined;
	effectsTail: Effect | undefined = undefined;
	onDispose: (() => void)[] = [];

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
		for (const cb of this.onDispose) {
			cb();
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
	nextNotify = undefined;
	prevEffect: Effect | undefined = undefined;
	nextEffect: Effect | undefined = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	prevUpdate = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		private fn: () => void
	) {
		this.scope.add(this);
		this.run();
	}

	notify() {
		Subscriber.update(this);
	}

	run() {
		const lastActiveSub = Subscriber.startTrack(this);
		this.fn();
		Subscriber.endTrack(this, lastActiveSub);
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
