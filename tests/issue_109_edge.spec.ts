import { expect, test } from 'vitest';
import { computed, effect, getActiveSub, signal } from '../src';
import { ReactiveFlags, type ReactiveNode } from '../src/system';

// (1) Side-effect after the dispose-trigger inside the effect body
//     should still run, just like in any other JS function — disposing
//     swaps the .fn property but the closure already on the stack must
//     finish executing.
test('self-dispose inside effect: code after dispose() still runs', () => {
	const s = signal(0);
	let dispose!: () => void;
	const stages: string[] = [];

	dispose = effect(() => {
		stages.push('start');
		s();
		if (s() === 1) {
			dispose();
			stages.push('after-dispose');
		}
		stages.push('end');
	});

	expect(stages).toEqual(['start', 'end']);
	s(1);
	expect(stages).toEqual([
		'start', 'end',                          // initial run
		'start', 'after-dispose', 'end',         // re-run; the fn body must finish
	]);
});

// (2) When dispose is triggered from *another* node's update (the
//     #109 path), the swapped fn replaces the user fn before run() calls
//     it — so the side-effect inside the user fn is never invoked.
//     This documents that this run is *skipped*, not just suppressed.
test('disposed-by-other-node effect: scheduled run is skipped entirely', () => {
	const s = signal(0);
	let dispose!: () => void;
	let bodyRuns = 0;

	const a = computed(() => {
		if (s() === 1) dispose();
		return s();
	});

	dispose = effect(() => { a(); bodyRuns++; });
	effect(() => { a(); });

	expect(bodyRuns).toBe(1);
	s(1);
	// The flush queued e1 because of the propagation; if e1 had been
	// disposed *between flushes*, this run wouldn't have been scheduled.
	// The fix-by-fn-swap turns the scheduled run into a no-op.
	expect(bodyRuns).toBe(1);
});

// (3) After being disposed mid-flush, the effect's graph state should
//     be clean: no deps, not Watching, no subs — otherwise future
//     propagations would still walk through it.
test('disposed effect: graph state is fully cleaned up', () => {
	const s = signal(0);
	let dispose!: () => void;
	let e1Node: ReactiveNode | undefined;

	const a = computed(() => {
		if (s() === 1) dispose();
		return s();
	});

	dispose = effect(() => {
		e1Node ??= getActiveSub();
		a();
	});
	effect(() => { a(); });

	s(1);

	expect(e1Node).toBeDefined();
	expect(e1Node!.deps).toBeUndefined();
	expect(e1Node!.flags & ReactiveFlags.Watching).toBe(0);
});
