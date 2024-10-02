import {
	computed as _computed,
	signal as _signal,
	currentEffectScope,
	System,
	Subscriber,
	Computed,
	Signal,
	Effect,
	DirtyLevels,
} from './index.js';

export {
	effect,
	Effect,
	effectScope,
	EffectScope,
} from './index.js';

const pausedSubsDepths: number[] = [];

export function pauseTracking() {
	pausedSubsDepths.push(System.activeSubsDepth);
	System.activeSubsDepth = 0;
}

export function resetTracking() {
	System.activeSubsDepth = pausedSubsDepths.pop()!;
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
		Subscriber.update(this, false);
		return this.versionOrDirtyLevel >= DirtyLevels.Dirty;
	}

	set scheduler(fn: () => void) {
		this.notify = fn;
	}
}

export function onScopeDispose(cb: () => void) {
	currentEffectScope.onDispose.push(cb);
}
