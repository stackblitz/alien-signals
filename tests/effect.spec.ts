import { expect, test } from 'vitest';
import { computed, effect, getActiveSub, signal } from '../src';
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

test('cleanup order on outer re-run: inner before outer, before new run', () => {
	const log: string[] = [];
	const a = signal(0);

	effect(() => {
		a();
		log.push('outer:run');
		effect(() => {
			log.push('inner:run');
			return () => log.push('inner:cleanup');
		});
		return () => log.push('outer:cleanup');
	});
	expect(log).toEqual(['outer:run', 'inner:run']);

	log.length = 0;
	a(1);
	expect(log).toEqual([
		'inner:cleanup',
		'outer:cleanup',
		'outer:run',
		'inner:run',
	]);
});

test('cleanup order on dispose: inner before outer', () => {
	const log: string[] = [];

	const dispose = effect(() => {
		log.push('outer:run');
		effect(() => {
			log.push('inner:run');
			return () => log.push('inner:cleanup');
		});
		return () => log.push('outer:cleanup');
	});
	log.length = 0;
	dispose();
	expect(log).toEqual(['inner:cleanup', 'outer:cleanup']);
});

test('sibling cleanup order on dispose: reverse creation (LIFO)', () => {
	const log: string[] = [];

	const dispose = effect(() => {
		effect(() => {
			return () => log.push('inner1:cleanup');
		});
		effect(() => {
			return () => log.push('inner2:cleanup');
		});
		effect(() => {
			return () => log.push('inner3:cleanup');
		});
		return () => log.push('outer:cleanup');
	});
	dispose();
	expect(log).toEqual([
		'inner3:cleanup',
		'inner2:cleanup',
		'inner1:cleanup',
		'outer:cleanup',
	]);
});

test('sibling cleanup order on outer re-run: reverse creation (LIFO)', () => {
	const log: string[] = [];
	const a = signal(0);

	effect(() => {
		a();
		effect(() => {
			return () => log.push('inner1:cleanup');
		});
		effect(() => {
			return () => log.push('inner2:cleanup');
		});
		effect(() => {
			return () => log.push('inner3:cleanup');
		});
		return () => log.push('outer:cleanup');
	});
	log.length = 0;

	a(1);
	expect(log.slice(0, 4)).toEqual([
		'inner3:cleanup',
		'inner2:cleanup',
		'inner1:cleanup',
		'outer:cleanup',
	]);
});

test('three-level nested cleanup on dispose: deepest first (depth-first reverse)', () => {
	const log: string[] = [];

	const dispose = effect(() => {
		effect(() => {
			effect(() => {
				return () => log.push('grandchild:cleanup');
			});
			return () => log.push('child:cleanup');
		});
		return () => log.push('outer:cleanup');
	});
	dispose();
	expect(log).toEqual([
		'grandchild:cleanup',
		'child:cleanup',
		'outer:cleanup',
	]);
});

test('computed unwatched: child effect cleanups run in reverse creation (LIFO)', () => {
	// When the computed loses its last subscriber and gets unwatched, any
	// effects it created during its getter must be cleaned up LIFO, not FIFO.
	const log: string[] = [];
	const c = computed(() => {
		effect(() => () => log.push('e1'));
		effect(() => () => log.push('e2'));
		effect(() => () => log.push('e3'));
		return 0;
	});
	const dispose = effect(() => { c(); });
	log.length = 0;
	dispose();
	expect(log).toEqual(['e3', 'e2', 'e1']);
});

test('effect created inside computed: old inner cleanup runs before new inner setup', () => {
	// When a computed re-evaluates, any effects its getter created on the
	// previous run must be disposed (with cleanup) before the getter runs
	// again. Otherwise the old inner's cleanup ends up running after the
	// new inner has already been set up.
	const a = signal(0);
	const log: string[] = [];

	const c = computed(() => {
		log.push('computed:eval');
		effect(() => {
			log.push('inner:run');
			return () => log.push('inner:cleanup');
		});
		return a();
	});

	effect(() => {
		c();
	});
	log.length = 0;

	a(1);
	expect(log).toEqual([
		'inner:cleanup',
		'computed:eval',
		'inner:run',
	]);
});

test('cleanup order is correct on outer re-run after a prior inner-only re-run', () => {
	// Regression: inner re-running alone routes outer through run()'s
	// not-dirty branch (restore Watching), which must preserve any
	// "has child effect" tracking so the next real outer re-run still
	// disposes children before its own cleanup.
	const a = signal(0);
	const b = signal(0);
	const log: string[] = [];

	effect(() => {
		a();
		log.push('outer:run');
		effect(() => {
			b();
			log.push('inner:run');
			return () => log.push('inner:cleanup');
		});
		return () => log.push('outer:cleanup');
	});

	b(1); // inner re-runs alone; outer is touched via notify chain
	log.length = 0;

	a(1);
	expect(log).toEqual([
		'inner:cleanup',
		'outer:cleanup',
		'outer:run',
		'inner:run',
	]);
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
