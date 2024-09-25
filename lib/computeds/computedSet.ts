import { computed } from '../computed';

export function computedSet<T>(getter: () => Set<T>) {
	return computed<Set<T>>((oldValue) => {
		const newValue = getter();
		if (oldValue?.size === newValue.size && [...oldValue].every(c => newValue.has(c))) {
			return oldValue;
		}
		return newValue;
	});
}
