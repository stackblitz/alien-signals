import { expect, test } from 'vitest';
import { computed, effect, signal } from '../src';

test('effect that caught a computed error on first evaluation re-runs when the computed recovers', () => {
	const source = signal(0);
	const c = computed(() => {
		if (source() === 0) {
			throw new Error('pending');
		}
		return source() * 2;
	});
	const seen: unknown[] = [];

	effect(() => {
		try {
			seen.push(c());
		} catch {
			seen.push('error');
		}
	});

	source(5);
	expect(seen).toEqual(['error', 10]);
});

test('effect that caught a computed error on a later evaluation re-runs when the computed recovers', () => {
	const source = signal(1);
	const c = computed(() => {
		if (source() === 0) {
			throw new Error('pending');
		}
		return source() * 2;
	});
	const seen: unknown[] = [];

	effect(() => {
		try {
			seen.push(c());
		} catch {
			seen.push('error');
		}
	});

	source(0);
	source(5);
	expect(seen).toEqual([2, 'error', 10]);
});

test('a computed error raised while checking an effect reaches the effect, not the writer', () => {
	const shouldThrow = signal(false);
	const c = computed(() => {
		if (shouldThrow()) {
			throw new Error('boom');
		}
		return 1;
	});
	const seen: unknown[] = [];

	effect(() => {
		try {
			seen.push(c());
		} catch {
			seen.push('error');
		}
	});

	expect(() => shouldThrow(true)).not.toThrow();
	expect(() => shouldThrow(false)).not.toThrow();
	expect(seen).toEqual([1, 'error', 1]);
});

test('reading a computed whose last evaluation threw does not return a value it never produced', () => {
	const source = signal(0);
	const c = computed(() => {
		if (source() === 0) {
			throw new Error('pending');
		}
		return source() * 2;
	});

	expect(() => c()).toThrow('pending');
	expect(() => c()).toThrow('pending');
	source(5);
	expect(c()).toBe(10);
});

test('reading a computed whose re-evaluation threw does not return the previous value', () => {
	const source = signal(1);
	const c = computed(() => {
		if (source() === 0) {
			throw new Error('pending');
		}
		return source() * 2;
	});

	expect(c()).toBe(2);
	source(0);
	expect(() => c()).toThrow('pending');
	expect(() => c()).toThrow('pending');
});

test('computed retries after its dependency changes and changes back', () => {
	const source = signal('a');
	let calls = 0;
	const c = computed(() => {
		const current = source();
		if (++calls === 1) {
			throw new Error('boom');
		}
		return current;
	});

	expect(() => c()).toThrow('boom');
	source('b');
	source('a');
	expect(c()).toBe('a');
});
