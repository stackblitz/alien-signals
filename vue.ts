import {
	computed as _computed,
	signal as _signal,
	activeSubsDepth,
	currentEffectScope,
	DirtyLevels,
	IEffect,
	pausedSubsIndex,
	setPausedSubsIndex,
	Subscriber,
} from './index.js';

export {
	effect,
	Effect,
	effectScope,
	EffectScope,
} from './index.js';

export type ShallowRef<T> = { value: T; };

const pausedSubsIndexes: number[] = [];

export function pauseTracking() {
	pausedSubsIndexes.push(pausedSubsIndex);
	setPausedSubsIndex(activeSubsDepth);
}

export function resetTracking() {
	setPausedSubsIndex(pausedSubsIndexes.pop()!);
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
