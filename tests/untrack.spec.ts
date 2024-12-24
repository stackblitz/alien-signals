import { untrack } from '../src';
import { signal, computed } from './api';
import { expect, test } from 'vitest';

test('should untrack', () => {
	const src = signal(0);
	const c = computed(() => untrack(() => src.get()));
	expect(c.get()).toBe(0);

	src.set(1);
	expect(c.get()).toBe(0);
});
