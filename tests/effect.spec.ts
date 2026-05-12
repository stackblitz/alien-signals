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
