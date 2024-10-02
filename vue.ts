import {
	computed as _computed,
	signal as _signal,
	currentEffectScope,
	System,
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

let pausedIndex = 0;
const pausedIndexes: number[] = [];

export function pauseTracking() {
	pausedIndexes.push(pausedIndex);
	pausedIndex = System.activeSubsDepth;
}

export function resetTracking() {
	pausedIndex = pausedIndexes.pop()!;
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
		if (System.activeSubsDepth - pausedIndex <= 0) {
			return this.value;
		}
		return this.get();
	}
	set value(value: T) {
		this.set(value);
	}
}

class VueComputed<T = any> extends Computed<T> {
	get value() {
		if (System.activeSubsDepth - pausedIndex <= 0) {
			this.update();
			return this.cachedValue;
		}
		return this.get();
	}
}

export class ReactiveEffect extends Effect {
	get dirty() {
		return Subscriber.isDirty(this);
	}

	set scheduler(fn: () => void) {
		this.notify = fn;
	}
}

export function onScopeDispose(cb: () => void) {
	currentEffectScope.onDispose.push(cb);
}
