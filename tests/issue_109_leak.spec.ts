import { expect, test } from 'vitest';
import { computed, effect, signal } from '../src';

test('disposed effect should not be re-notified on later updates', () => {
	const s = signal(0);
	let dispose1!: () => void;
	let e1runs = 0;

	const a = computed(() => {
		if (s() === 1) dispose1();
		return s();
	});

	dispose1 = effect(() => { a(); e1runs++; });
	effect(() => { a(); });

	expect(e1runs).toBe(1);
	s(1);
	expect(e1runs).toBe(1);

	// If e1 was actually disposed, further signal changes shouldn't
	// involve it at all. With the fn-swap fix, e1 stays subscribed to `a`
	// and gets notified each time, even though fn is now a no-op.
	s(2);
	s(3);
	s(4);
	expect(e1runs).toBe(1);
});
