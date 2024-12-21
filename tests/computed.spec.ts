import { expect, test } from 'vitest';
import { computed, signal } from '../src';

test('should not update if the signal value is reverted', () => {
	let cTimes = 0;

	const src = signal(0);
	const c = computed(() => {
		cTimes++;
		return src.get();
	});

	c.get();
	src.set(1);
	src.set(0);
	c.get();

	expect(cTimes).toBe(1);
});
