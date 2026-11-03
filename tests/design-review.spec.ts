// Repros for the design review. Each test asserts the correct behavior and is
// marked `test.fails` while the library still exhibits the defect; when a fix
// lands the test starts failing as "unexpectedly passed" and should be turned
// into a plain `test`.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { computed, effect, endBatch, getActiveSub, isComputed, isSignal, signal, startBatch } from '../src';

const root = join(__dirname, '..');

test.fails('computed that threw on first read rethrows on re-read instead of returning undefined', () => {
	const s = signal(0);
	const c = computed(() => {
		if (s() === 0) throw new Error('boom');
		return s();
	});
	expect(() => c()).toThrow('boom');
	expect(() => c()).toThrow('boom');
});

test.fails('computed that threw after a success does not return its stale previous value', () => {
	const s = signal(1);
	const c = computed(() => {
		if (s() === 2) throw new Error('boom');
		return s() * 10;
	});
	expect(c()).toBe(10);
	s(2);
	expect(() => c()).toThrow('boom');
	expect(() => c()).toThrow('boom');
});

test.fails('computed reading itself fails loudly instead of returning a value built from undefined', () => {
	const c: () => number = computed(() => (c() ?? 0) + 1);
	expect(() => c()).toThrow();
});

test.fails('mutually dependent computeds (#123) fail loudly instead of hanging', () => {
	const script = `
		import { computed, signal } from ${JSON.stringify(join(root, 'esm/index.mjs'))};
		const fieldA = signal(false), fieldB = signal(false);
		const a = computed(() => b() !== true ? fieldA() : null);
		const b = computed(() => a() !== true ? fieldB() : null);
		try { a(); b(); fieldA(true); a(); } catch { process.exit(0); }
		process.exit(1);
	`;
	const r = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', script], { timeout: 5000 });
	expect(r.status).toBe(0);
});

test.fails('an effect throwing during flush does not drop sibling effects queued by the same write', () => {
	const s = signal(0);
	const seen: number[] = [];
	effect(() => {
		if (s() === 1) throw new Error('A');
	});
	effect(() => {
		seen.push(s());
	});
	expect(() => s(1)).toThrow('A');
	expect(seen).toEqual([0, 1]);
});

test.fails('a stray endBatch() does not permanently stop all effects', () => {
	endBatch();
	try {
		const s = signal(0);
		const seen: number[] = [];
		effect(() => {
			seen.push(s());
		});
		s(1);
		expect(seen).toEqual([0, 1]);
	} finally {
		startBatch();
	}
});

test.fails('an effect whose concise arrow returns a non-function value survives its second run', () => {
	const s = signal(1);
	effect((() => s()) as () => void);
	expect(() => s(2)).not.toThrow();
});

test.fails('isSignal does not accept an unrelated function that happens to be named signalOper', () => {
	function signalOper() { }
	expect(isSignal(signalOper.bind(null))).toBe(false);
});

test.fails('CJS and ESM entry points share one reactive graph (no dual-package split)', async () => {
	const esm = await import(join(root, 'esm/index.mjs'));
	const cjs = createRequire(__filename)(join(root, 'cjs/index.cjs'));
	const s = cjs.signal(0);
	let runs = 0;
	esm.effect(() => {
		s();
		runs++;
	});
	s(1);
	expect(runs).toBe(2);
});

test('cross-instance: ESM isComputed recognizes a CJS computed it cannot track', async () => {
	const cjs = createRequire(__filename)(join(root, 'cjs/index.cjs'));
	expect(isComputed(cjs.computed(() => 1))).toBe(true);
});

test.fails('ReactiveFlags from alien-signals/system is usable under isolatedModules', () => {
	const dir = mkdtempSync(join(tmpdir(), 'alien-flags-'));
	const file = join(dir, 'consumer.ts');
	writeFileSync(file, `import { ReactiveFlags } from ${JSON.stringify(join(root, 'types/system'))};\nexport const f = ReactiveFlags.Mutable;\n`);
	let ok = true;
	try {
		execFileSync(process.execPath, [
			join(root, 'node_modules/typescript/bin/tsc'),
			'--noEmit', '--strict', '--isolatedModules', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'esnext', file,
		], { stdio: 'pipe' });
	} catch {
		ok = false;
	}
	expect(ok).toBe(true);
});

test.fails('a signal write never re-runs an effect when the value is unchanged (NaN)', () => {
	const s = signal(NaN);
	let runs = 0;
	effect(() => {
		s();
		runs++;
	});
	s(NaN);
	expect(runs).toBe(1);
});

test.fails('an effect disposed during its own run is not re-subscribed by later reads (#118 class)', () => {
	const s = signal(0);
	const t = signal(0);
	let stop!: () => void;
	let node: any;
	let phase = false;
	stop = effect(() => {
		node ??= getActiveSub();
		s();
		if (phase) {
			stop();
			t();
		}
	});
	phase = true;
	s(1);
	expect(node.deps).toBeUndefined();
});
