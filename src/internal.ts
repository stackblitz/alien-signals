import { Computed, updateComputed } from './computed.js';
import { Effect, notifyEffect } from './effect.js';
import { EffectScope } from './effectScope.js';
import { createSystem, Dependency, Subscriber } from './system.js';

export function isComputed(sub: Subscriber & Dependency): sub is Computed {
	return 'getter' in sub;
}

export function isEffect(sub: Subscriber): sub is Effect | EffectScope {
	return 'run' in sub;
}

const {
	drainQueuedEffects,
	endTrack,
	isDirty,
	link,
	propagate,
	runInnerEffects,
	shallowPropagate,
	startTrack,
} = createSystem({
	isComputed,
	isEffect,
	updateComputed,
	notifyEffect,
});

export {
	drainQueuedEffects,
	endTrack,
	isDirty,
	link,
	propagate,
	runInnerEffects,
	shallowPropagate,
	startTrack,
};
