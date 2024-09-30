import {
	computed as _computed,
	signal as _signal,
	currentEffectScope,
	pauseTracking as _pauseTracking,
	resetTracking as _resetTracking,
	Subscriber,
	Computed,
	Signal,
	Effect,
} from './index.js';

export {
	effect,
	Effect,
	effectScope,
	EffectScope,
} from './index.js';

let pausedStack = 0;

export function pauseTracking() {
	if (pausedStack === 0) {
		_pauseTracking();
	}
	pausedStack++;
}

export function resetTracking() {
	pausedStack--;
	if (pausedStack === 0) {
		_resetTracking(pausedStack);
	}
}

export function shallowRef<T>(): ShallowRef<T | undefined>;
export function shallowRef<T>(oldValue: T): ShallowRef<T>;
export function shallowRef<T>(value?: T) {
	return new ShallowRef(value);
}

export function computed<T>(fn: () => T) {
	return new VueComputed(fn);
}

export function getCurrentScope() {
	return currentEffectScope;
}

export class ShallowRef<T = any> extends Signal<T> {
	get value() {
		return this.get();
	}
	set value(value: T) {
		this.set(value);
	}
}

class VueComputed<T = any> extends Computed<T> {
	get value() {
		return this.get();
	}
}

export class ReactiveEffect extends Effect {
	get dirty() {
		return Subscriber.isDirty(this);
	}

	set scheduler(fn: () => void) {
		this.queue = fn;
	}
}
