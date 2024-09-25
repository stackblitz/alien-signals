import {
	signal as _signal,
	computed as _computed,
	currentEffectScope,
} from './index.js';

export {
	effect,
	effectScope,
} from './index.js';

export function shallowRef<T>(value: T) {
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

export function getCurrentEffectScope() {
	return currentEffectScope;
}
