import { expect, test } from 'vitest';
import { computed, effect, signal } from '../src';

/**
 * Regression test: after a computed's getter throws on first evaluation, the
 * computed is left in a cached `Mutable` state with `value` unset. A
 * subsequent read (e.g. from an unrelated re-run of the subscriber, or a
 * direct re-read) must re-throw the stored error rather than return the stale
 * `undefined` value.
 */
test('computed that throws on first eval re-throws on unrelated re-runs (not stale undefined)', () => {
	const s = signal(0);
	const other = signal(0);
	let getterCalls = 0;
	const c = computed(() => {
		getterCalls++;
		if (s() === 0) {
			throw new Error('PENDING');
		}
		return s() * 2;
	});

	let effectRuns = 0;
	let effectValue: unknown = 'unset';
	const stop = effect(() => {
		effectRuns++;
		other(); // subscribe to an unrelated signal
		try {
			effectValue = c();
		} catch (e) {
			effectValue = 'threw';
		}
	});

	expect(effectRuns).toBe(1);
	expect(effectValue).toBe('threw');

	// Writing an unrelated signal re-runs the effect, but the computed's own
	// deps haven't changed, so the getter is NOT re-invoked. The stored error
	// must be re-thrown (not a stale `undefined` returned).
	other(1);
	expect(effectRuns).toBe(2);
	expect(getterCalls).toBe(1);
	expect(effectValue).toBe('threw');
	stop();
});

test('computed that throws on first eval re-throws on direct re-read (not stale undefined)', () => {
	const s = signal(0);
	let getterCalls = 0;
	const c = computed(() => {
		getterCalls++;
		if (s() === 0) {
			throw new Error('PENDING');
		}
		return s() * 2;
	});

	// First read throws.
	expect(() => c()).toThrow('PENDING');
	expect(getterCalls).toBe(1);

	// A direct re-read with unchanged deps must re-throw the stored error,
	// not return the stale cached `undefined`.
	expect(() => c()).toThrow('PENDING');
	expect(getterCalls).toBe(1);

	// Once the dep changes, the getter re-runs and succeeds.
	s(5);
	expect(c()).toBe(10);
	expect(getterCalls).toBe(2);
});
