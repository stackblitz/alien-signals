import { expect, test } from 'vitest';
import { computed, signal } from './api';

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
