import { expect, test } from 'vitest';
import { effect, effectScope, getActiveSub, signal } from '../src';
import { ReactiveFlags, type ReactiveNode } from '../src/system';

test('stopped effect does not subscribe to signals read later in the same run', () => {
	const rerun = signal(0);
	const readAfterStop = signal(0);
	let stop!: () => void;
	let node: ReactiveNode | undefined;
	let stopDuringRun = false;
	let runs = 0;

	stop = effect(() => {
		node ??= getActiveSub();
		runs++;
		rerun();
		if (stopDuringRun) {
			stop();
			readAfterStop();
		}
	});

	expect(runs).toBe(1);

	stopDuringRun = true;
	rerun(1);

	expect(runs).toBe(2);
	expect(node!.flags).toBe(ReactiveFlags.None);
	expect(node!.deps).toBeUndefined();
});

test('failed effect setup does not leave a live subscription behind', () => {
	const source = signal(0);
	let runs = 0;

	expect(() =>
		effect(() => {
			runs++;
			source();
			throw new Error('setup failed');
		})
	).toThrow('setup failed');

	expect(runs).toBe(1);
	expect(() => source(1)).not.toThrow();
	expect(runs).toBe(1);
});

test('failed effect scope setup disposes child effects created before throw', () => {
	const source = signal(0);
	let childRuns = 0;

	expect(() =>
		effectScope(() => {
			effect(() => {
				childRuns++;
				source();
			});
			throw new Error('scope setup failed');
		})
	).toThrow('scope setup failed');

	expect(childRuns).toBe(1);
	source(1);
	expect(childRuns).toBe(1);
});
