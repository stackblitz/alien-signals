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

test('should correctly propagate changes through computed signals', () => {
	const src = signal(0);
	const c1 = computed(() => src.get() % 2);
	const c2 = computed(() => c1.get());
	const c3 = computed(() => c2.get());

	c3.get();
	src.set(1); // c1 -> dirty, c2 -> toCheckDirty, c3 -> toCheckDirty
	c2.get(); // c1 -> none, c2 -> none
	src.set(3); // c1 -> dirty, c2 -> toCheckDirty

	expect(c3.get()).toBe(1);
});
