import { expect, test } from 'vitest';
import { computed, effect, endBatch, signal, startBatch } from '../src';

function rng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6D2B79F5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Kind = 'signal' | 'target' | 'computed' | 'effect' | 'writer';

interface Spec {
	kind: Kind;
	srcs: number[];
	mod: number;
	target?: number;
}

// Which sources get read depends on the values read before, so dependency
// sets change from one evaluation to the next.
function evalSpec(spec: Spec, read: (i: number) => number): number {
	const s = spec.srcs;
	let v: number;
	if (s.length === 1) {
		v = read(s[0]) + 1;
	} else if (s.length === 2) {
		v = read(s[0]) + read(s[1]);
	} else {
		v = read(s[0]) % 2 ? read(s[1]) + 1 : read(s[2]) * 2 + (s.length > 3 ? read(s[3]) : 0);
	}
	return spec.mod ? ((v % spec.mod) + spec.mod) % spec.mod : v | 0;
}

// Builds a random graph, drives it with writes, batches and effects being
// disposed and created again, and after every step compares what the effects
// saw and what the computeds return with an evaluation from scratch.
function runCase(seed: number, size: number, ops: number, writers: boolean) {
	const rand = rng(seed);
	const int = (n: number) => Math.floor(rand() * n);
	const specs: Spec[] = [];
	const readable: number[] = [];

	for (let i = 0; i < size; i++) {
		const r = rand();
		if (i < 3 || r < 0.2) {
			specs.push({ kind: 'signal', srcs: [], mod: 0 });
			readable.push(i);
			continue;
		}
		const srcs: number[] = [];
		for (let k = 1 + int(4); k > 0; k--) {
			srcs.push(readable[int(readable.length)]);
		}
		const mod = rand() < 0.5 ? 2 + int(3) : 0;
		if (r < 0.65) {
			specs.push({ kind: 'computed', srcs, mod });
			readable.push(i);
		} else if (r < 0.9 || !writers) {
			specs.push({ kind: 'effect', srcs, mod });
		} else {
			// an effect that writes what it computed into a signal of its own
			specs.push({ kind: 'writer', srcs, mod, target: i + 1 });
			specs.push({ kind: 'target', srcs: [], mod: 0 });
			readable.push(i + 1);
			i++;
		}
	}

	const shadow = specs.map(() => 0);
	const nodes: ((v?: number) => any)[] = [];
	const seen: (number | undefined)[] = specs.map(() => undefined);
	const disposers: ((() => void) | undefined)[] = specs.map(() => undefined);
	const read = (i: number) => nodes[i]() as number;

	const create = (i: number) => {
		const spec = specs[i];
		disposers[i] = effect(() => {
			const v = evalSpec(spec, read);
			seen[i] = v;
			if (spec.target !== undefined) {
				nodes[spec.target](v);
			}
		});
	};

	specs.forEach((spec, i) => {
		if (spec.kind === 'signal' || spec.kind === 'target') {
			nodes[i] = signal(0);
		}
	});
	specs.forEach((spec, i) => {
		if (spec.kind === 'computed') {
			nodes[i] = computed(() => evalSpec(spec, read));
		} else if (spec.kind === 'effect' || spec.kind === 'writer') {
			create(i);
		}
	});

	const check = (step: number) => {
		const values: number[] = [];
		specs.forEach((spec, i) => {
			if (spec.kind === 'signal') {
				values[i] = shadow[i];
			} else if (spec.kind === 'target') {
				// set by its writer; a disposed writer leaves the last value
				values[i] ??= shadow[i];
			} else {
				const v = evalSpec(spec, j => values[j]);
				values[i] = v;
				if (spec.kind === 'writer') {
					if (disposers[i] !== undefined) {
						shadow[spec.target!] = v;
					}
					values[spec.target!] = shadow[spec.target!];
				}
			}
		});
		specs.forEach((spec, i) => {
			if (spec.kind === 'effect' || spec.kind === 'writer') {
				if (disposers[i] !== undefined) {
					expect(seen[i], `seed ${seed} step ${step}: effect ${i}`).toBe(values[i]);
				}
			} else if (rand() < 0.3) {
				expect(nodes[i](), `seed ${seed} step ${step}: ${spec.kind} ${i}`).toBe(values[i]);
			}
		});
	};

	const sources = specs.flatMap((s, i) => s.kind === 'signal' ? [i] : []);
	const effects = specs.flatMap((s, i) => s.kind === 'effect' || s.kind === 'writer' ? [i] : []);
	const write = () => {
		const i = sources[int(sources.length)];
		shadow[i] = int(5);
		nodes[i](shadow[i]);
	};

	check(-1);
	for (let step = 0; step < ops; step++) {
		const r = rand();
		if (r < 0.6) {
			write();
		} else if (r < 0.85) {
			startBatch();
			for (let k = 1 + int(4); k > 0; k--) {
				write();
			}
			endBatch();
		} else if (effects.length) {
			const i = effects[int(effects.length)];
			if (disposers[i] !== undefined) {
				disposers[i]!();
				disposers[i] = undefined;
			} else {
				create(i);
			}
		}
		check(step);
	}
}

const cases = Number((globalThis as { process?: { env: Record<string, string | undefined>; }; }).process?.env.FUZZ_CASES ?? 1000);

test('random graphs agree with an evaluation from scratch', { timeout: 600_000 }, () => {
	for (let seed = 1; seed <= cases; seed++) {
		runCase(seed, 6 + (seed % 20), 40, false);
	}
});

// Fails: an effect that writes a signal flushes the queue from inside its
// own run. An effect that runs in there and writes something the outer one
// has already read is treated like the outer effect writing its own
// dependency, which does not make it run again. Nothing else is queued, so
// the outer effect keeps what it saw until one of its dependencies changes
// once more.
test.fails('an effect sees what another effect wrote while it was running', () => {
	const a = signal(0);
	const b = signal(0);
	const out = signal(0);
	const sum = computed(() => a() + b());
	const watched = computed(() => out());
	let seen = -1;

	sum();
	watched();
	effect(() => { b(a()); });
	effect(() => {
		seen = sum();
		out(seen);
	});
	a(1);

	expect(sum()).toBe(2);
	expect(seen).toBe(2);
});

test.fails('random graphs with effects that write agree with an evaluation from scratch', { timeout: 600_000 }, () => {
	for (let seed = 1; seed <= cases; seed++) {
		runCase(seed, 6 + (seed % 20), 40, true);
	}
});
