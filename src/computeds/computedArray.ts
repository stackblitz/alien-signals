import { computed } from '../computed';

export function computedArray<I, O>(
	arr: () => I[],
	getGetter: (item: () => I, index: number) => () => O
) {
	const length = computed(() => arr().length);
	const keys = computed(() => {
		const keys: string[] = [];
		for (let i = 0; i < length(); i++) {
			keys.push(String(i));
		}
		return keys;
	});
	const items = computed<(() => O)[]>((array) => {
		array ??= [];
		while (array.length < length()) {
			const index = array.length;
			const item = computed(() => arr()[index]);
			array.push(computed(getGetter(item, index)));
		}
		if (array.length > length()) {
			array.length = length();
		}
		return array;
	});

	return new Proxy({}, {
		get(_, p, receiver) {
			if (p === 'length') {
				return length();
			}
			if (typeof p === 'string' && !isNaN(Number(p))) {
				return items()[Number(p)]?.();
			}
			return Reflect.get(items(), p, receiver);
		},
		has(_, p) {
			return Reflect.has(items(), p);
		},
		ownKeys() {
			return keys();
		},
	}) as unknown as readonly Readonly<O>[];
}
