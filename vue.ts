import {
	computed as _computed,
	signal as _signal,
	activeSubsDepth,
	currentEffectScope,
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

export class ReactiveEffect {
	private sub = new Subscriber(undefined, this);
	private scope = currentEffectScope;

	scheduler?: () => void;

	constructor(
		private fn: () => void
	) {
		this.sub.trackStart();
		fn();
		this.sub.trackEnd();
		this.scope.effects.add(this);
	}

	run() {
		if (this.scheduler) {
			this.scheduler();
		}
		else if (this.sub.isDirty()) {
			this.sub.trackStart();
			this.fn();
			this.sub.trackEnd();
		}
	}

	stop() {
		this.sub.trackStart();
		this.sub.trackEnd();
		this.scope.effects.delete(this);
	}
}
