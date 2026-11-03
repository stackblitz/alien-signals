import { expect, test } from 'vitest';
import { computed, effect, effectScope, endBatch, getActiveSub, signal, startBatch } from '../src';
import { ReactiveFlags, type ReactiveNode } from '../src/system';

test('stopped effect does not subscribe to signals read later in the same run', () => {
	const rerun = signal(0);
	const readAfterStop = signal(0);
	let node: ReactiveNode | undefined;
	let stopDuringRun = false;
	let runs = 0;

	const stop = effect(() => {
		node ??= getActiveSub();
		runs++;
		rerun();
		if (stopDuringRun) {
			stop();
			readAfterStop();
		}
	});

	stopDuringRun = true;
	rerun(1);

	expect(runs).toBe(2);
	expect(node!.flags).toBe(ReactiveFlags.None);
	expect(node!.deps).toBeUndefined();
});

test('computed read after its subscriber stopped is left unwatched', () => {
	const source = signal(0);
	let computedNode: ReactiveNode | undefined;
	const double = computed(() => {
		computedNode ??= getActiveSub();
		return source() * 2;
	});
	let stopDuringRun = false;

	const stop = effect(() => {
		if (stopDuringRun) {
			stop();
			double();
		}
		else {
			source();
		}
	});

	stopDuringRun = true;
	source(1);
	expect(computedNode!.subs).toBeUndefined();
});

test('effect stopped by its child effect does not track later reads', () => {
	const trigger = signal(0);
	const readAfterStop = signal(0);
	let node: ReactiveNode | undefined;
	let runs = 0;

	const stop = effect(() => {
		node ??= getActiveSub();
		runs++;
		if (trigger()) {
			effect(() => {
				stop();
			});
			readAfterStop();
		}
	});

	trigger(1);
	expect(runs).toBe(2);
	expect(node!.deps).toBeUndefined();
	readAfterStop(1);
	expect(runs).toBe(2);
});

test('child effect created after its owner stopped is not owned by the stopped owner', () => {
	const trigger = signal(0);
	let node: ReactiveNode | undefined;

	const stop = effect(() => {
		node ??= getActiveSub();
		if (trigger()) {
			stop();
			effect(() => {});
		}
	});

	trigger(1);
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

test('effect that throws on a later run stays alive and re-runs', () => {
	const source = signal(0);
	let runs = 0;

	effect(() => {
		runs++;
		if (source() === 1) {
			throw new Error('run failed');
		}
	});

	expect(() => source(1)).toThrow('run failed');
	expect(runs).toBe(2);
	source(2);
	expect(runs).toBe(3);
});

test('running effect keeps tracking after a batched write queues it', () => {
	const childSource = signal(0);
	const later = signal(0);
	let runs = 0;

	effect(() => {
		runs++;
		effect(() => {
			childSource();
		});
		if (runs === 1) {
			startBatch();
			childSource(1);
			later();
			endBatch();
		}
		else {
			later();
		}
	});

	expect(runs).toBe(1);
	later(1);
	expect(runs).toBe(2);
});
