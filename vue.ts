import {
	computed as _computed,
	signal as _signal,
	currentEffectScope,
	DirtyLevels,
	IEffect,
	pauseTracking as _pauseTracking,
	resetTracking as _resetTracking,
	Subscriber,
} from './index.js';

export {
	effect,
	Effect,
	effectScope,
	EffectScope,
} from './index.js';

export type ShallowRef<T> = { value: T; };

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
	const s = _signal(value);
	return {
		get value() {
			return s.get();
		},
		set value(value: T) {
			s.set(value);
		}
	};
}

export function computed<T>(fn: () => T) {
	const c = _computed(fn);
	return {
		get value() {
			return c.get();
		}
	};
}

export function getCurrentScope() {
	return currentEffectScope;
}

export class ReactiveEffect implements IEffect, Subscriber {
	private scope = currentEffectScope;
	queuedNext = null;

	// Subscriber
	firstDep = null;
	lastDep = null;
	depsLength = 0;
	dirtyLevel = DirtyLevels.Dirty;
	version = -1;

	scheduler?: () => void;

	constructor(
		private fn: () => void
	) {
		const lastActiveSub = Subscriber.trackStart(this);
		fn();
		Subscriber.trackEnd(this, lastActiveSub);
		this.scope.effects.add(this);
	}

	run() {
		if (this.scheduler) {
			this.scheduler();
		}
		else if (Subscriber.isDirty(this)) {
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
