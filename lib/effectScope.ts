import { Effect } from './effect';

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
		} else {
			this.effects = this.effectsTail = effect;
		}
	}

	remove(effect: Effect) {
		if (effect.prevEffect !== undefined) {
			effect.prevEffect.nextEffect = effect.nextEffect;
		} else {
			this.effects = effect.nextEffect;
		}
		if (effect.nextEffect !== undefined) {
			effect.nextEffect.prevEffect = effect.prevEffect;
		} else {
			this.effectsTail = effect.prevEffect;
		}
	}
}

export let currentEffectScope = new EffectScope();
