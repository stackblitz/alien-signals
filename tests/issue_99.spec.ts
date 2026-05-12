import { expect, test } from 'vitest';
import { computed, effect, signal } from '../src';

test('#99 consecutive inner resets through computed chain', () => {
	const s = signal(0);
	const c = computed(() => s());
	let runs = 0;

	effect(() => {
		runs++;
		if (c() > 0) {
			s(0);
		}
	});

	expect(runs).toBe(1);
	s(1);
	expect(s()).toBe(0);
	expect(runs).toBe(2);
	s(2);
	expect(s()).toBe(0);
	expect(runs).toBe(3);
	s(3);
	expect(s()).toBe(0);
	expect(runs).toBe(4);
});
