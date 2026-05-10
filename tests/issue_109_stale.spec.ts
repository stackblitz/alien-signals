import { expect, test } from 'vitest';
import { computed, effect, signal } from '../src';

test('#109 stale-link: disposed effect still runs', () => {
	const s = signal(0);
	let dispose1!: () => void;
	let e1runs = 0;

	const a = computed(() => {
		if (s() === 1) dispose1();
		return s();
	});

	dispose1 = effect(() => { a(); e1runs++; });
	effect(() => { a(); }); // second subscriber keeps `a` alive

	expect(e1runs).toBe(1);
	s(1);
	expect(e1runs).toBe(1); // disposed during update(a); should not re-run
});
