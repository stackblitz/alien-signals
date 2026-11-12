import { expect, test } from 'vitest';
import { computed, effect, endBatch, signal, startBatch } from '../index';

// Counts how often getters and effects are called and compares that with two
// reference models that are driven by the same operations and only know the
// functions as deterministic black boxes:
//
//   trace: a node remembers what its last run read, and runs again exactly
//          when one of those values is different. No implementation that
//          keeps one run per node can call fewer functions without knowing
//          more about them, so this is the target.
//   memo:  a computed remembers every run it ever made. Unbounded memory;
//          only here to show how far the target is from the absolute floor.

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

interface Result {
	getters: number;
	runs: number;
	reads: number[];
	seen: (number | undefined)[];
}

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

function generate(seed: number, size: number, nOps: number) {
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
	for (let k = 0; k < nOps; k++) {
		const r = rand();
		if (r < 0.45) {
			ops.push(['write', signals[int(signals.length)], int(3)]);
		} else if (r < 0.65) {
			ops.push(['batchStart']);
			for (let j = 1 + int(4); j > 0; j--) {
				ops.push(['write', signals[int(signals.length)], int(3)]);
			}
			ops.push(['batchEnd']);
		} else if (r < 0.85 && computeds.length) {
			ops.push(['read', computeds[int(computeds.length)]]);
		} else if (effects.length) {
			ops.push(['toggle', effects[int(effects.length)]]);
		}
	}
	return { specs, ops };
}

function runLibrary(specs: Spec[], ops: Op[]): Result {
	const res: Result = { getters: 0, runs: 0, reads: [], seen: specs.map(() => undefined) };
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
				res.getters++;
				return evalSpec(spec, read);
			});
		} else {
			create(i);
		}
	});
	for (const op of ops) {
		if (op[0] === 'write') {
			nodes[op[1]](op[2]);
		} else if (op[0] === 'batchStart') {
			startBatch();
		} else if (op[0] === 'batchEnd') {
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

type Trace = [dep: number, value: number][];
type Trie = { leaf: true; value: number; } | { leaf: false; dep: number; kids: Map<number, Trie>; };

function runModel(specs: Spec[], ops: Op[], mode: 'trace' | 'memo'): Result {
	const res: Result = { getters: 0, runs: 0, reads: [], seen: specs.map(() => undefined) };
	const current = specs.map(() => 0);
	const value: number[] = [];
	const trace: (Trace | undefined)[] = specs.map(() => undefined);
	const tries: (Trie | undefined)[] = specs.map(() => undefined);
	const checked = specs.map(() => -1);
	const alive = specs.map(() => false);
	let epoch = 0;
	let batch = 0;

	function get(i: number): number {
		if (specs[i].kind === 'signal') {
			return current[i];
		}
		ensure(i);
		return value[i];
	}

	function valid(t: Trace): boolean {
		for (const [dep, seen] of t) {
			if (get(dep) !== seen) {
				return false;
			}
		}
		return true;
	}

	function evaluate(i: number, isEffect: boolean): Trace {
		const t: Trace = [];
		const v = evalSpec(specs[i], j => {
			const x = get(j);
			t.push([j, x]);
			return x;
		});
		if (isEffect) {
			res.runs++;
			res.seen[i] = v;
		} else {
			res.getters++;
			value[i] = v;
		}
		return t;
	}

	function ensure(i: number) {
		if (checked[i] === epoch) {
			return;
		}
		if (mode === 'trace') {
			if (!trace[i] || !valid(trace[i])) {
				trace[i] = evaluate(i, false);
			}
		} else {
			// Walk the decision tree of everything this getter was ever seen
			// to read; a run is only needed for a path not taken before.
			let node = tries[i];
			while (node && !node.leaf) {
				node = node.kids.get(get(node.dep));
			}
			if (node) {
				value[i] = node.value;
			} else {
				const t = evaluate(i, false);
				const leaf: Trie = { leaf: true, value: value[i] };
				let cur = tries[i] ??= t.length ? { leaf: false, dep: t[0][0], kids: new Map() } : leaf;
				for (let k = 0; k < t.length && !cur.leaf; k++) {
					let next: Trie | undefined = cur.kids.get(t[k][1]);
					if (!next) {
						next = k + 1 < t.length ? { leaf: false, dep: t[k + 1][0], kids: new Map() } : leaf;
						cur.kids.set(t[k][1], next);
					}
					cur = next;
				}
			}
		}
		checked[i] = epoch;
	}

	function flush() {
		for (let i = 0; i < specs.length; i++) {
			if (alive[i] && !valid(trace[i]!)) {
				trace[i] = evaluate(i, true);
			}
		}
	}

	specs.forEach((spec, i) => {
		if (spec.kind === 'effect') {
			alive[i] = true;
			trace[i] = evaluate(i, true);
		}
	});
	for (const op of ops) {
		if (op[0] === 'write') {
			if (current[op[1]] !== op[2]) {
				current[op[1]] = op[2];
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
		} else {
			alive[op[1]] = true;
			trace[op[1]] = evaluate(op[1], true);
		}
	}
	return res;
}

test('getters and effects are called exactly as often as the last-run model needs', { timeout: 600_000 }, () => {
	const cases = Number((globalThis as { process?: { env: Record<string, string | undefined>; }; }).process?.env.FUZZ_CASES ?? 1000);
	const total = { library: 0, trace: 0, memo: 0 };
	for (let seed = 1; seed <= cases; seed++) {
		const { specs, ops } = generate(seed, 5 + (seed % 14), 30);
		const library = runLibrary(specs, ops);
		const trace = runModel(specs, ops, 'trace');
		const memo = runModel(specs, ops, 'memo');

		expect(library.reads, `seed ${seed} values read`).toEqual(trace.reads);
		expect(library.seen, `seed ${seed} values seen by effects`).toEqual(trace.seen);
		expect(memo.reads, `seed ${seed} values read (memo)`).toEqual(trace.reads);
		expect(library.getters, `seed ${seed} getter calls`).toBe(trace.getters);
		expect(library.runs, `seed ${seed} effect runs`).toBe(trace.runs);
		expect(memo.runs, `seed ${seed} effect runs (memo)`).toBe(trace.runs);

		total.library += library.getters;
		total.trace += trace.getters;
		total.memo += memo.getters;
	}
	expect(total.library).toBe(total.trace);
	expect(total.memo).toBeLessThanOrEqual(total.trace);
});
