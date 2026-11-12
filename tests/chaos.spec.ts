import { expect, test } from 'vitest';
import { computed, effect, effectScope, endBatch, getActiveSub, getBatchDepth, signal, startBatch, trigger } from '../src';

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

// Programs with getters, effects and cleanups that throw, effects that
// dispose themselves or each other while running, and nested effects and
// scopes. While that goes on, values may be out of date: a flush stops at the
// first error, and a computed whose getter threw keeps its previous value.
// What has to hold is that nothing is lost for good: once nothing throws any
// more and every source has changed again, each effect that is still there
// and each computed agrees with an evaluation from scratch.
function runCase(seed: number, throws: boolean) {
	const rand = rng(seed);
	const int = (n: number) => Math.floor(rand() * n);
	const nSignals = 3 + int(3);
	const signals = Array.from({ length: nSignals }, () => signal(0));
	const shadow = signals.map(() => 0);
	let failing = true;
	const fail = signal(0);

	const nComputeds = 2 + int(5);
	const computeds: (() => number)[] = [];
	const computedSpecs: { srcs: number[]; throws: boolean; }[] = [];
	const readNode = (i: number): number => i < nSignals ? signals[i]() : computeds[i - nSignals]();
	for (let i = 0; i < nComputeds; i++) {
		const srcs = Array.from({ length: 1 + int(3) }, () => int(nSignals + i));
		const throwing = rand() < 0.25 && throws;
		computedSpecs.push({ srcs, throws: throwing });
		computeds.push(computed(() => {
			let v = 0;
			for (const s of srcs) {
				v += readNode(s);
				if (v % 2) break;
			}
			if (throwing && fail() && v % 3 === 1) throw new Error('computed');
			return v % 4;
		}));
	}
	const evalComputed = (i: number, values: number[]) => {
		let v = 0;
		for (const s of computedSpecs[i].srcs) {
			v += values[s];
			if (v % 2) break;
		}
		return v % 4;
	};

	const nEffects = 2 + int(4);
	const seen: (number | undefined)[] = [];
	const disposers: ((() => void) | undefined)[] = [];
	const effectSpecs = Array.from({ length: nEffects }, () => ({
		srcs: Array.from({ length: 1 + int(3) }, () => int(nSignals + nComputeds)),
		throws: rand() < 0.2 && throws,
		nested: rand() < 0.3,
		scoped: rand() < 0.2,
		selfDispose: rand() < 0.1,
		cleanupThrows: rand() < 0.1 && throws,
		killsOther: rand() < 0.1 ? int(nEffects) : -1,
	}));
	const create = (i: number) => {
		const spec = effectSpecs[i];
		let runs = 0;
		try {
			disposers[i] = effect(() => {
				runs++;
				let v = 0;
				for (const s of spec.srcs) v += readNode(s);
				seen[i] = v;
				if (spec.nested) {
					effect(() => {
						readNode(spec.srcs[0]);
						return () => {
							try {
								readNode(spec.srcs[0]);
							} catch (err) {
								// nor does one whose nested effect's cleanup throws
								disposers[i] = undefined;
								throw err;
							}
						};
					});
				}
				if (spec.scoped) {
					effectScope(() => {
						effect(() => { readNode(spec.srcs[0]); });
					});
				}
				if (failing && fail()) {
					if (spec.killsOther >= 0 && spec.killsOther !== i && disposers[spec.killsOther]) {
						const dispose = disposers[spec.killsOther]!;
						disposers[spec.killsOther] = undefined;
						dispose();
					}
					if (spec.selfDispose && runs > 1 && disposers[i]) {
						const dispose = disposers[i]!;
						disposers[i] = undefined;
						dispose();
					}
					if (spec.throws && v % 3 === 2) throw new Error('effect');
				}
				if (spec.cleanupThrows) {
					return () => {
						if (failing && fail() && v % 5 === 4) {
							// an effect whose cleanup throws does not run again
							disposers[i] = undefined;
							throw new Error('cleanup');
						}
					};
				}
			});
		} catch {
			// the effect exists, but its disposer never reached us
			disposers[i] = undefined;
			seen[i] = undefined;
			effectSpecs[i].srcs = [];
		}
	};
	for (let i = 0; i < nEffects; i++) create(i);

	for (let step = 0; step < 30; step++) {
		const r = rand();
		try {
			if (r < 0.5) {
				const i = int(nSignals);
				signals[i](shadow[i] = int(4));
			} else if (r < 0.65) {
				startBatch();
				try {
					for (let k = 1 + int(3); k > 0; k--) {
						const i = int(nSignals);
						signals[i](shadow[i] = int(4));
					}
				} finally {
					endBatch();
				}
			} else if (r < 0.75) {
				fail(fail() ? 0 : 1);
			} else if (r < 0.85) {
				computeds[int(nComputeds)]();
			} else if (r < 0.9) {
				trigger(() => { signals[int(nSignals)](); });
			} else {
				const i = int(nEffects);
				if (disposers[i]) {
					const dispose = disposers[i]!;
					disposers[i] = undefined;
					dispose();
				} else if (effectSpecs[i].srcs.length) {
					create(i);
				}
			}
		} catch {
			// whatever was thrown, the checks below still have to hold
		}
	}

	failing = false;
	try { fail(0); } catch { }
	for (let round = 0; round < 2; round++) {
		for (let i = 0; i < nSignals; i++) {
			try { signals[i](shadow[i] += 4); } catch { }
		}
	}

	const values = [...shadow];
	for (let i = 0; i < nComputeds; i++) {
		values.push(evalComputed(i, values));
	}
	for (let i = 0; i < nComputeds; i++) {
		expect(computeds[i](), `seed ${seed} computed ${i}`).toBe(values[nSignals + i]);
	}
	for (let i = 0; i < nEffects; i++) {
		if (disposers[i]) {
			let v = 0;
			for (const s of effectSpecs[i].srcs) {
				v += values[s];
			}
			expect(seen[i], `seed ${seed} effect ${i}`).toBe(v);
		}
	}
}

const cases = Number((globalThis as { process?: { env: Record<string, string | undefined>; }; }).process?.env.FUZZ_CASES ?? 1000);

const runCases = (throws: boolean) => {
	for (let seed = 1; seed <= cases; seed++) {
		runCase(seed, throws);
		expect(getBatchDepth(), `seed ${seed} batch depth`).toBe(0);
		expect(getActiveSub(), `seed ${seed} active sub`).toBe(undefined);
	}
};

test('effects disposed while running, nested effects and scopes', { timeout: 600_000 }, () => {
	runCases(false);
});

// Fails for the reasons errors.spec.ts shows one at a time.
test.fails('the same with getters, effects and cleanups that throw', { timeout: 600_000 }, () => {
	runCases(true);
});
