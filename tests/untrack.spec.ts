import { getDefaultSystem } from '../src';
import { expect, test } from 'vitest';

const { signal, untrack, computed } = getDefaultSystem();

test('should untrack', () => {
	const src = signal(0);
	const c = computed(() => untrack(() => src()));
	expect(c()).toBe(0);

	src(1);
	expect(c()).toBe(0);
});
