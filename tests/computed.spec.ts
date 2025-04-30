import { expect, test } from 'vitest';
import { computed, signal } from '../src';

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

test('should propagate updated source value through chained computations', () => {
	const src = signal(0);
	const a = computed(() => src());
	const b = computed(() => a() % 2);
	const c = computed(() => src());
	const d = computed(() => b() + c());

	expect(d()).toBe(0);
	src(2);
	expect(d()).toBe(2);
});

test('should handle flags are indirectly updated during checkDirty', () => {
	const a = signal(false);
	const b = computed(() => a());
	const c = computed(() => {
		b();
		return 0;
	});
	const d = computed(() => {
		c();
		return b();
	});

	expect(d()).toBe(false);
	a(true);
	expect(d()).toBe(true);
});

test('should not update if the signal value is reverted', () => {
	let times = 0;

	const src = signal(0);
	const c1 = computed(() => {
		times++;
		return src();
	});
	c1();
	expect(times).toBe(1);
	src(1);
	src(0);
	c1();
	expect(times).toBe(1);
});
