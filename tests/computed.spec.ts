import { expect, test } from 'vitest';
import { getDefaultSystem } from '../src';

const { signal, computed } = getDefaultSystem();

test('should correctly propagate changes through computed signals', () => {
	const src = signal(0);
	const c1 = computed(() => src() % 2);
	const c2 = computed(() => c1());
	const c3 = computed(() => c2());

	c3();
	src(1); // c1 -> dirty, c2 -> toCheckDirty, c3 -> toCheckDirty
	c2(); // c1 -> none, c2 -> none
	src(3); // c1 -> dirty, c2 -> toCheckDirty

	expect(c3()).toBe(1);
});
