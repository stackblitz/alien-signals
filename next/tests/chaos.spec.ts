import { expect, test } from 'vitest';
import { computed, effect, effectScope, endBatch, getActiveSub, getBatchDepth, signal, startBatch, trigger } from '../index';

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
// scopes. Whatever happens, every effect that is still there and every
// computed has to agree with an evaluation from scratch, in which a computed
// that throws makes whatever reads it throw as well.
function runCase(seed: number) {
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
		const throws = rand() < 0.25;
		computedSpecs.push({ srcs, throws });
		computeds.push(computed(() => {
			let v = 0;
			for (const s of srcs) {
				v += readNode(s);
				if (v % 2) break;
			}
			if (throws && fail() && v % 3 === 1) throw new Error('computed');
			return v % 4;
		}));
	}
	// `undefined` stands for a computed that throws
	const evalComputed = (i: number, values: (number | undefined)[], failOn: boolean) => {
		let v = 0;
		for (const s of computedSpecs[i].srcs) {
			const x = values[s];
			if (x === undefined) return undefined;
			v += x;
			if (v % 2) break;
		}
		if (computedSpecs[i].throws && failOn && v % 3 === 1) return undefined;
		return v % 4;
	};
	let failOn = false;
	const verify = (label: string) => {
		const values: (number | undefined)[] = [...shadow];
		for (let i = 0; i < nComputeds; i++) values.push(evalComputed(i, values, failOn));
		for (let i = 0; i < nEffects; i++) {
			if (disposers[i]) {
				let v: number | undefined = 0;
				for (const s of effectSpecs[i].srcs) {
					const x = values[s];
					v = v === undefined || x === undefined ? undefined : v + x;
				}
				// an effect that could not read all of its sources has not reported anything
				if (v !== undefined) {
					expect(seen[i], `seed ${seed} ${label} effect ${i}`).toBe(v);
				}
			}
		}
		for (let i = 0; i < nComputeds; i++) {
			let got: number | undefined;
			try { got = computeds[i](); } catch { got = undefined; }
			expect(got, `seed ${seed} ${label} computed ${i}`).toBe(values[nSignals + i]);
		}
	};

	const nEffects = 2 + int(4);
	const seen: (number | undefined)[] = [];
	const disposers: ((() => void) | undefined)[] = [];
	const effectSpecs = Array.from({ length: nEffects }, () => ({
		srcs: Array.from({ length: 1 + int(3) }, () => int(nSignals + nComputeds)),
		throws: rand() < 0.2,
		nested: rand() < 0.3,
		scoped: rand() < 0.2,
		selfDispose: rand() < 0.1,
		cleanupThrows: rand() < 0.1,
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
						return () => { readNode(spec.srcs[0]); };
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
							// an effect whose cleanup throws is disposed
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
				failOn = !failOn;
				fail(failOn ? 1 : 0);
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
		// half of the cases are left alone until the end, as the reads made
		// by the checks bring computeds up to date themselves
		if (seed % 2) {
			verify(`step ${step}`);
		}
	}

	failing = false;
	failOn = false;
	try { fail(0); } catch { }
	verify('end');
}

test('stays consistent through failures, disposal during runs and nesting', { timeout: 600_000 }, () => {
	const cases = Number((globalThis as { process?: { env: Record<string, string | undefined>; }; }).process?.env.FUZZ_CASES ?? 1000);
	for (let seed = 1; seed <= cases; seed++) {
		runCase(seed);
		expect(getBatchDepth(), `seed ${seed} batch depth`).toBe(0);
		expect(getActiveSub(), `seed ${seed} active sub`).toBe(undefined);
	}
});
