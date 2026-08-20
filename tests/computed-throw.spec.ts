import { expect, test } from 'vitest';
import { computed, effect, signal } from '../src';

/**
 * Regression test: a computed whose getter throws on FIRST evaluation must
 * still be linked to its subscriber, so it re-runs once its dependencies
 * change and the getter can succeed.
 *
 * Before the fix, `computedOper` linked the computed to the active subscriber
 * AFTER running the getter; a throwing getter skipped the link entirely,
 * leaving the computed permanently stale (never re-evaluated, never
 * propagated). This is the computed counterpart of the effect/effectScope
 * teardown issues in #118.
 */
test('computed that throws on first eval recovers after dependency change', () => {
	const s = signal(0);
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
		try {
			effectValue = c();
		} catch (e) {
			effectValue = 'threw';
		}
	});

	// First run: getter throws, effect catches it.
	expect(effectRuns).toBe(1);
	expect(effectValue).toBe('threw');
	expect(getterCalls).toBe(1);

	// Change the dependency so the getter would now succeed.
	s(5);

	// The effect must re-run and read the new value.
	expect(effectRuns).toBe(2);
	expect(effectValue).toBe(10);
	expect(getterCalls).toBe(2);
	stop();
});
