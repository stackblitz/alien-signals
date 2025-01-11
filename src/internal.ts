import { createSystem, Dependency, Subscriber } from './system.js';
import { Computed } from './computed.js';
import { Effect } from './effect.js';

export function isComputed(sub: Subscriber & Dependency): sub is Computed {
	return 'update' in sub;
}

export function isEffect(sub: Subscriber & Dependency): sub is Effect {
	return 'notify' in sub;
}

const {
	endTrack,
	isDirty,
	link,
	propagate,
	runInnerEffects,
	drainQueuedEffects,
	shallowPropagate,
	startTrack,
} = createSystem({
	isComputed,
	isEffect,
	updateComputed(computed) {
		return computed.update();
	},
	notifyEffect(effect) {
		effect.notify();
	},
});

export {
	endTrack,
	isDirty,
	link,
	propagate,
	runInnerEffects,
	drainQueuedEffects,
	shallowPropagate,
	startTrack,
};
