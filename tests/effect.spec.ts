import { expect, test } from 'vitest';
import { effect, getActiveSub, signal } from '../src';
import { ReactiveFlags } from '../src/system';

test('should support custom recurse effect', () => {
	const src = signal(0);

	let triggers = 0;

	effect(() => {
		getActiveSub()!.flags &= ~ReactiveFlags.RecursedCheck;
		triggers++;
		src(Math.min(src() + 1, 5));
	});

	expect(triggers).toBe(6);
});

// https://github.com/stackblitz/alien-signals/issues/115
test('outer effect keeps responding to its own dep after inner re-runs', () => {
	const a = signal(0);
	const b = signal(0);
	let outerRuns = 0;
	let innerRuns = 0;

	effect(() => {
		a();
		outerRuns++;
		effect(() => {
			b();
			innerRuns++;
		});
	});
	expect(outerRuns).toBe(1);
	expect(innerRuns).toBe(1);

	b(1);
	expect(outerRuns).toBe(1);
	expect(innerRuns).toBeGreaterThanOrEqual(2);

	a(1);
	expect(outerRuns).toBe(2);
});
