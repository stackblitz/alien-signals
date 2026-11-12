import { expect, test } from 'vitest';
import { computed, effect, effectScope, endBatch, signal, startBatch, trigger } from '../index';

declare const gc: (() => void) | undefined;

test('effect does not re-run when a batch leaves its dependencies unchanged', () => {
	const a = signal(0);
	let computedRuns = 0;
	let effectRuns = 0;
	const double = computed(() => {
		computedRuns++;
		return a() * 2;
	});
	effect(() => {
		effectRuns++;
		double();
	});

	startBatch();
	a(1);
	a(0);
	endBatch();

	expect(computedRuns).toBe(1);
	expect(effectRuns).toBe(1);
});

test('computed is not re-evaluated when a dependency returns to the value it read', () => {
	const a = signal(0);
	let runs = 0;
	const c = computed(() => {
		runs++;
		return a() + 1;
	});

	expect(c()).toBe(1);
	a(1);
	a(0);
	expect(c()).toBe(1);
	expect(runs).toBe(1);
});

test('unchanged computed value stops re-evaluation downstream', () => {
	const a = signal(1);
	let downstreamRuns = 0;
	const parity = computed(() => a() % 2);
	const label = computed(() => {
		downstreamRuns++;
		return parity() ? 'odd' : 'even';
	});
	effect(() => {
		label();
	});

	a(3);
	a(5);

	expect(downstreamRuns).toBe(1);
});

test('unwatched computed keeps its value across unrelated writes', () => {
	const a = signal(1);
	const unrelated = signal(0);
	let runs = 0;
	const c = computed(() => {
		runs++;
		return a() + 1;
	});

	expect(c()).toBe(2);
	unrelated(1);
	expect(c()).toBe(2);
	expect(runs).toBe(1);

	a(2);
	expect(c()).toBe(3);
	expect(runs).toBe(2);
});

test('computed keeps its value after losing its last subscriber', () => {
	const a = signal(1);
	let runs = 0;
	const c = computed(() => {
		runs++;
		return a() + 1;
	});
	const stop = effect(() => {
		c();
	});

	stop();
	expect(c()).toBe(2);
	expect(runs).toBe(1);

	a(2);
	expect(c()).toBe(3);
	expect(runs).toBe(2);
});

test('computed that changed while unwatched is up to date when subscribed again', () => {
	const a = signal(1);
	const c = computed(() => a() + 1);
	const d = computed(() => c() * 10);
	const seen: number[] = [];

	expect(d()).toBe(20);
	a(2);
	const stop = effect(() => {
		seen.push(d());
	});
	a(3);
	stop();
	a(4);
	expect(d()).toBe(50);
	expect(seen).toEqual([30, 40]);
});

test('effects see a consistent state when another effect writes during a batch', () => {
	const a = signal(0);
	const b = signal(0);
	const t = signal(0);
	const u = signal(0);
	let seenT = -1;

	effect(() => {
		seenT = t();
		u(a());
	});
	effect(() => {
		t(b());
	});
	effect(() => {
		u();
	});

	startBatch();
	a(1);
	b(1);
	endBatch();

	expect(t()).toBe(1);
	expect(seenT).toBe(1);
});

test('effect that writes one of its own dependencies re-runs until it settles', () => {
	const count = signal(0);
	let runs = 0;

	effect(() => {
		runs++;
		if (count() < 5) {
			count(count() + 1);
		}
	});

	expect(count()).toBe(5);
	expect(runs).toBe(6);
});

test('effects triggered by a write inside an effect run after that effect finishes', () => {
	const a = signal(0);
	const b = signal(0);
	const log: string[] = [];

	effect(() => {
		log.push(`b=${b()}`);
	});
	effect(() => {
		log.push('writer start');
		b(a());
		log.push('writer end');
	});
	log.length = 0;

	a(1);

	expect(log).toEqual(['writer start', 'writer end', 'b=1']);
});

test('effects that never settle are reported instead of looping forever', () => {
	const a = signal(0);
	const b = signal(0);

	expect(() => {
		effect(() => {
			a(a() + 1);
		});
	}).toThrow('Cycle detected');

	let runs = 0;
	effect(() => {
		runs++;
		b();
	});
	b(1);
	expect(runs).toBe(2);
});

test('computed that reads itself is reported as a cycle', () => {
	const a = signal(0);
	const c: () => number = computed(() => a() + c());

	expect(() => c()).toThrow('Cycle detected');
	expect(() => c()).toThrow('Cycle detected');
});

test('computeds that read each other are reported as a cycle', () => {
	const a = signal(0);
	const x: () => number = computed(() => a() + y());
	const y: () => number = computed(() => x() + 1);

	expect(() => x()).toThrow('Cycle detected');
	a(1);
	expect(() => y()).toThrow('Cycle detected');
});

test('error thrown by a getter is kept until a dependency changes', () => {
	const a = signal(0);
	const b = signal(0);
	let runs = 0;
	const c = computed(() => {
		runs++;
		if (!a()) {
			throw new Error('zero');
		}
		return a();
	});

	expect(() => c()).toThrow('zero');
	expect(() => c()).toThrow('zero');
	b(1);
	expect(() => c()).toThrow('zero');
	expect(runs).toBe(1);

	a(2);
	expect(c()).toBe(2);
	expect(c()).toBe(2);
	expect(runs).toBe(2);
});

test('getter that throws runs once however many subscribers it has', () => {
	const a = signal(1);
	let runs = 0;
	const c = computed(() => {
		runs++;
		if (!a()) {
			throw new Error('zero');
		}
		return a();
	});
	const d = computed(() => c() + 1);
	const seen: unknown[] = [];
	for (let i = 0; i < 3; i++) {
		effect(() => {
			try {
				seen.push(i % 2 ? d() : c());
			} catch (err) {
				seen.push((err as Error).message);
			}
		});
	}
	runs = 0;
	seen.length = 0;

	a(0);
	expect(runs).toBe(1);
	expect(seen).toEqual(['zero', 'zero', 'zero']);

	a(3);
	expect(runs).toBe(2);
	expect(seen).toEqual(['zero', 'zero', 'zero', 3, 4, 3]);
});

test('getter receives its last value, not the error, after it threw', () => {
	const a = signal(1);
	const previous: unknown[] = [];
	const c = computed<number>(prev => {
		previous.push(prev);
		if (!a()) {
			throw new Error('zero');
		}
		return a();
	});

	c();
	a(0);
	expect(() => c()).toThrow('zero');
	a(5);
	c();

	expect(previous).toEqual([undefined, 1, 1]);
});

test('effect that throws does not keep the others from running', () => {
	const a = signal(0);
	const seen: string[] = [];
	effect(() => { seen.push('first ' + a()); });
	effect(() => {
		if (a() === 1) {
			throw new Error('second');
		}
		seen.push('second ' + a());
	});
	effect(() => { seen.push('third ' + a()); });
	seen.length = 0;

	expect(() => a(1)).toThrow('second');
	expect(seen).toEqual(['first 1', 'third 1']);

	a(2);
	expect(seen).toEqual(['first 1', 'third 1', 'first 2', 'second 2', 'third 2']);
});

test('effect recovers after a computed it reads throws', () => {
	const a = signal(1);
	const seen: number[] = [];
	const c = computed(() => {
		if (!a()) {
			throw new Error('zero');
		}
		return a();
	});
	effect(() => {
		seen.push(c());
	});

	expect(() => a(0)).toThrow('zero');
	a(2);

	expect(seen).toEqual([1, 2]);
});

test('effect disposed during its own run stops and gets its cleanup called', () => {
	const a = signal(0);
	const b = signal(0);
	let runs = 0;
	let cleanups = 0;
	let stop!: () => void;

	stop = effect(() => {
		runs++;
		if (a() === 1) {
			stop();
		}
		b();
		return () => {
			cleanups++;
		};
	});

	a(1);
	expect(runs).toBe(2);
	expect(cleanups).toBe(2);

	a(2);
	b(1);
	expect(runs).toBe(2);
	expect(cleanups).toBe(2);
});

test('signal read directly inside a scope belongs to the enclosing effect', () => {
	const a = signal(0);
	let outerRuns = 0;
	let scopeRuns = 0;

	effect(() => {
		outerRuns++;
		effectScope(() => {
			scopeRuns++;
			a();
		});
	});
	a(1);

	expect(outerRuns).toBe(2);
	expect(scopeRuns).toBe(2);
});

test('trigger re-evaluates watched and unwatched computeds of a mutated value', () => {
	const list = signal<number[]>([]);
	const watched = computed(() => list().length);
	const unwatched = computed(() => list().length);
	const seen: number[] = [];
	effect(() => {
		seen.push(watched());
	});

	expect(unwatched()).toBe(0);
	list().push(1);
	trigger(list);

	expect(seen).toEqual([0, 1]);
	expect(unwatched()).toBe(1);
});

test.skipIf(typeof gc !== 'function')('unwatched computed is not kept alive by the signals it read', async () => {
	const source = signal(0);
	let collected = 0;
	const registry = new FinalizationRegistry(() => {
		collected++;
	});
	(() => {
		for (let i = 0; i < 100; i++) {
			const c = computed(() => source() + i);
			if (i % 2) {
				effect(() => {
					c();
				})();
			}
			c();
			registry.register(c, undefined);
		}
	})();

	for (let i = 0; i < 5 && collected < 100; i++) {
		await new Promise(resolve => setTimeout(resolve, 20));
		gc!();
	}

	expect(collected).toBe(100);
});

test('cleanup of a nested effect may dispose its siblings', () => {
	const a = signal(0);
	const log: string[] = [];
	let disposeSecond: (() => void) | undefined;
	effect(() => {
		a();
		effect(() => () => { log.push('first'); });
		disposeSecond = effect(() => () => { log.push('second'); });
		effect(() => () => {
			log.push('third');
			disposeSecond!();
		});
	});

	a(1);
	expect(log).toEqual(['third', 'second', 'first']);
});

test('effect still re-runs when the cleanup of a nested effect throws', () => {
	const a = signal(0);
	const log: string[] = [];
	effect(() => {
		log.push('outer ' + a());
		effect(() => () => { log.push('cleanup 1'); });
		effect(() => () => {
			if (a() === 1) {
				throw new Error('cleanup 2');
			}
		});
		effect(() => () => { log.push('cleanup 3'); });
	});
	log.length = 0;

	expect(() => a(1)).toThrow('cleanup 2');
	expect(log).toEqual(['cleanup 3', 'cleanup 1', 'outer 1']);

	a(2);
	expect(log).toEqual(['cleanup 3', 'cleanup 1', 'outer 1', 'cleanup 3', 'cleanup 1', 'outer 2']);
});

test('disposing releases everything even when a cleanup throws', () => {
	const a = signal(0);
	const log: string[] = [];
	const dispose = effect(() => {
		a();
		effect(() => {
			log.push('inner ' + a());
			return () => { throw new Error('inner cleanup'); };
		});
		return () => { log.push('outer cleanup'); };
	});
	log.length = 0;

	expect(() => dispose()).toThrow('inner cleanup');
	expect(log).toEqual(['outer cleanup']);

	a(1);
	expect(log).toEqual(['outer cleanup']);
});

test('computed that owns effects starts over once nothing observes it', () => {
	const a = signal(1);
	const log: string[] = [];
	const previous: unknown[] = [];
	const c = computed<number>(prev => {
		previous.push(prev);
		effect(() => {
			log.push('inner ' + a());
			return () => { log.push('inner cleanup'); };
		});
		if (a() === 2) {
			throw new Error('two');
		}
		return a();
	});
	const stop = effect(() => {
		try {
			c();
		} catch {
			log.push('failed');
		}
	});

	log.length = 0;

	a(2);
	expect(log.slice(-3)).toEqual(['inner cleanup', 'inner 2', 'failed']);

	log.length = 0;
	stop();
	expect(log).toEqual(['inner cleanup']);

	a(3);
	expect(log).toEqual(['inner cleanup']);
	expect(c()).toBe(3);
	expect(previous).toEqual([undefined, 1, 1]);
});
