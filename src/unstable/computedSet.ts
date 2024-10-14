import { Computed, computed, Signal } from '../index.js';

export function computedSet<T>(source: Signal<Set<T>> | Computed<Set<T>>) {
	return computed<Set<T>>(
		(oldValue) => {
			const newValue = source.get();
			if (oldValue?.size === newValue.size && [...oldValue].every(c => newValue.has(c))) {
				return oldValue;
			}
			return newValue;
		}
	);
}
