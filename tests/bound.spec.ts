import { expect, test } from 'vitest';
import { computed, effect, endBatch, signal, startBatch } from '../src';

// Counts how often getters and effects are called, and compares that with
// reference models that are driven by the same operations and only know the
// functions as deterministic black boxes. A model is defined by two choices:
//
//   compare  'version': a node runs again when something it read has been
//                       assigned a different value since (what src does)
//            'value':   a node runs again when something it read has a
//                       different value now than it had then
//   unwatched 'drop':   a computed forgets its value when its last
//                       subscriber goes away (what src does)
//             'keep':   it keeps it
//
// version/drop is the model of src; the two differ by a few calls either way
// because the order in which effects run decides whether a computed is
// without subscribers for a moment. The other three show how many calls each
// choice would save on a given workload. This is a measurement, not a target:
// what is asserted is that src returns the right values, runs effects as
// often as every model does, and calls getters no less often than value/keep.
//
//   BOUND_REPORT=1 FUZZ_CASES=20000 pnpm vitest run tests/bound.spec.ts --reporter=default

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

type Kind = 'signal' | 'computed' | 'effect';

interface Spec {
	kind: Kind;
	srcs: number[];
	mod: number;
}

type Op = ['write', number, number] | ['batchStart'] | ['batchEnd'] | ['read', number] | ['toggle', number];
type OpKind = 'create' | 'write' | 'batch' | 'read' | 'toggle';

interface Workload {
	// signals are written with integers below this
	values: number;
	// whether half of the computeds reduce their result modulo 2 to 4
	mod: boolean;
	// whether effects are disposed and created again
	toggle: boolean;
}

interface Result {
	getters: Record<OpKind, number>;
	runs: number;
	reads: number[];
	seen: (number | undefined)[];
}

const newResult = (specs: Spec[]): Result => ({
	getters: { create: 0, write: 0, batch: 0, read: 0, toggle: 0 },
	runs: 0,
	reads: [],
	seen: specs.map(() => undefined),
});

const opKind = (op: Op, inBatch: boolean): OpKind =>
	inBatch || op[0] === 'batchStart' || op[0] === 'batchEnd' ? 'batch' : op[0] as OpKind;

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

// 5 to 18 nodes: 3 or more signals, then computeds and effects (7:3) that
// read 1 to 4 earlier signals or computeds. 30 steps: 45% one write, 20% a
// batch of 1 to 4 writes, 20% read a computed, 15% dispose or create an effect.
function generate(seed: number, workload: Workload) {
	const size = 5 + (seed % 14);
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
		const mod = rand() < 0.5 && workload.mod ? 2 + int(3) : 0;
		if (r < 0.7) {
			specs.push({ kind: 'computed', srcs, mod });
			readable.push(i);
		} else {
			specs.push({ kind: 'effect', srcs, mod });
		}
	}
	const pick = (kind: Kind) => specs.flatMap((s, i) => s.kind === kind ? [i] : []);
	const signals = pick('signal');
	const computeds = pick('computed');
	const effects = pick('effect');
	const ops: Op[] = [];
	for (let k = 0; k < 30; k++) {
		const r = rand();
		if (r < 0.45) {
			ops.push(['write', signals[int(signals.length)], int(workload.values)]);
		} else if (r < 0.65) {
			ops.push(['batchStart']);
			for (let j = 1 + int(4); j > 0; j--) {
				ops.push(['write', signals[int(signals.length)], int(workload.values)]);
			}
			ops.push(['batchEnd']);
		} else if (r < 0.85 && computeds.length) {
			ops.push(['read', computeds[int(computeds.length)]]);
		} else if (effects.length && workload.toggle) {
			ops.push(['toggle', effects[int(effects.length)]]);
		}
	}
	return { specs, ops };
}

function runLibrary(specs: Spec[], ops: Op[]): Result {
	const res = newResult(specs);
	let kind: OpKind = 'create';
	const nodes: ((v?: number) => any)[] = [];
	const disposers: ((() => void) | undefined)[] = [];
	const read = (i: number) => nodes[i]() as number;
	const create = (i: number) => {
		disposers[i] = effect(() => {
			res.runs++;
			res.seen[i] = evalSpec(specs[i], read);
		});
	};
	specs.forEach((spec, i) => {
		if (spec.kind === 'signal') {
			nodes[i] = signal(0);
		} else if (spec.kind === 'computed') {
			nodes[i] = computed(() => {
				res.getters[kind]++;
				return evalSpec(spec, read);
			});
		} else {
			create(i);
		}
	});
	let inBatch = false;
	for (const op of ops) {
		kind = opKind(op, inBatch);
		if (op[0] === 'write') {
			nodes[op[1]](op[2]);
		} else if (op[0] === 'batchStart') {
			inBatch = true;
			startBatch();
		} else if (op[0] === 'batchEnd') {
			inBatch = false;
			endBatch();
		} else if (op[0] === 'read') {
			res.reads.push(nodes[op[1]]());
		} else if (disposers[op[1]]) {
			disposers[op[1]]!();
			disposers[op[1]] = undefined;
		} else {
			create(op[1]);
		}
	}
	return res;
}

type Trace = [dep: number, stamp: number][];

function runModel(specs: Spec[], ops: Op[], compare: 'version' | 'value', unwatched: 'drop' | 'keep'): Result {
	const res = newResult(specs);
	let kind: OpKind = 'create';
	// a signal written in a batch takes its new value when it is first read
	const pending = specs.map(() => 0);
	const committed = specs.map(() => 0);
	const version = specs.map(() => 0);
	const value: number[] = [];
	const trace: (Trace | undefined)[] = specs.map(() => undefined);
	const checked = specs.map(() => -1);
	const subs = specs.map(() => new Set<number>());
	const alive = specs.map(() => false);
	let epoch = 0;
	let batch = 0;

	const stamp = (dep: number, v: number) => compare === 'version' ? version[dep] : v;

	function get(i: number): number {
		if (specs[i].kind === 'signal') {
			if (pending[i] !== committed[i]) {
				committed[i] = pending[i];
				version[i]++;
			}
			return committed[i];
		}
		if (checked[i] !== epoch) {
			if (!trace[i] || !valid(trace[i])) {
				setTrace(i, evaluate(i, false));
			}
			checked[i] = epoch;
		}
		return value[i];
	}

	function valid(t: Trace): boolean {
		for (const [dep, seen] of t) {
			if (stamp(dep, get(dep)) !== seen) {
				return false;
			}
		}
		return true;
	}

	function setTrace(i: number, t: Trace | undefined) {
		const old = trace[i];
		trace[i] = t;
		if (unwatched === 'keep') {
			return;
		}
		const now = new Set((t ?? []).map(x => x[0]));
		for (const d of now) {
			subs[d].add(i);
		}
		if (old) {
			for (let k = old.length - 1; k >= 0; k--) {
				if (!now.has(old[k][0])) {
					unsubscribe(old[k][0], i);
				}
			}
		}
	}

	function unsubscribe(dep: number, i: number) {
		if (subs[dep].delete(i) && !subs[dep].size && specs[dep].kind === 'computed' && trace[dep]) {
			checked[dep] = -1;
			setTrace(dep, undefined);
		}
	}

	function evaluate(i: number, isEffect: boolean): Trace {
		const t: Trace = [];
		if (isEffect) {
			res.runs++;
		} else {
			res.getters[kind]++;
		}
		const v = evalSpec(specs[i], j => {
			const x = get(j);
			t.push([j, stamp(j, x)]);
			return x;
		});
		if (isEffect) {
			res.seen[i] = v;
		} else {
			if (v !== value[i]) {
				version[i]++;
			}
			value[i] = v;
		}
		return t;
	}

	function flush() {
		for (let i = 0; i < specs.length; i++) {
			if (alive[i] && !valid(trace[i]!)) {
				setTrace(i, evaluate(i, true));
			}
		}
	}

	specs.forEach((spec, i) => {
		if (spec.kind === 'effect') {
			alive[i] = true;
			setTrace(i, evaluate(i, true));
		}
	});
	for (const op of ops) {
		kind = opKind(op, batch > 0);
		if (op[0] === 'write') {
			if (pending[op[1]] !== op[2]) {
				pending[op[1]] = op[2];
				epoch++;
				if (!batch) {
					flush();
				}
			}
		} else if (op[0] === 'batchStart') {
			batch++;
		} else if (op[0] === 'batchEnd') {
			if (!--batch) {
				flush();
			}
		} else if (op[0] === 'read') {
			res.reads.push(get(op[1]));
		} else if (alive[op[1]]) {
			alive[op[1]] = false;
			setTrace(op[1], undefined);
		} else {
			alive[op[1]] = true;
			setTrace(op[1], evaluate(op[1], true));
		}
	}
	return res;
}

const env = (globalThis as { process?: { env: Record<string, string | undefined>; }; }).process?.env ?? {};
const cases = Number(env.FUZZ_CASES ?? 1000);
const total = (r: Result) => r.getters.create + r.getters.write + r.getters.batch + r.getters.read + r.getters.toggle;

const workloads: [string, Workload][] = [
	['values 0-2, modulo, effects toggled', { values: 3, mod: true, toggle: true }],
	['values 0-2, modulo', { values: 3, mod: true, toggle: false }],
	['values below 1e6, effects toggled', { values: 1e6, mod: false, toggle: true }],
	['values below 1e6', { values: 1e6, mod: false, toggle: false }],
];

for (const [name, workload] of workloads) {
	test(`getter and effect calls: ${name}`, { timeout: 600_000 }, () => {
		const models = [['version', 'drop'], ['version', 'keep'], ['value', 'drop'], ['value', 'keep']] as const;
		const sums = { src: newResult([]).getters, models: models.map(() => 0), runs: 0 };
		const excess = newResult([]).getters;
		for (let seed = 1; seed <= cases; seed++) {
			const { specs, ops } = generate(seed, workload);
			const src = runLibrary(specs, ops);
			const results = models.map(([compare, unwatched]) => runModel(specs, ops, compare, unwatched));
			const floor = results[3];

			for (const model of results) {
				expect(model.reads, `seed ${seed} values read`).toEqual(src.reads);
				expect(model.seen, `seed ${seed} values seen by effects`).toEqual(src.seen);
				expect(model.runs, `seed ${seed} effect runs`).toBe(src.runs);
			}
			expect(total(src), `seed ${seed} getter calls`).toBeGreaterThanOrEqual(total(floor));

			sums.runs += src.runs;
			results.forEach((model, k) => sums.models[k] += total(model));
			for (const kind of Object.keys(excess) as OpKind[]) {
				sums.src[kind] += src.getters[kind];
				excess[kind] += src.getters[kind] - floor.getters[kind];
			}
		}
		if (env.BOUND_REPORT) {
			const all = total({ getters: sums.src } as Result);
			const pct = (n: number) => (100 * (n - all) / all).toFixed(2) + '%';
			console.log([
				`${name}: ${cases} cases, ${sums.runs} effect runs, ${all} getter calls in src`,
				...models.map(([compare, unwatched], k) => `  model ${compare}/${unwatched}: ${sums.models[k]} (${pct(sums.models[k])})`),
				`  calls src makes and value/keep does not, by the step they happen in: ${JSON.stringify(excess)}`,
			].join('\n'));
		}
	});
}
