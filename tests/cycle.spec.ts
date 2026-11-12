import { expect, test } from 'vitest';

declare function require(module: string): any;
declare const process: { execPath: string; env: Record<string, string | undefined>; };

// Runs against the build in a process of its own with a small heap: where
// this goes wrong it does not return, it allocates until the process dies.
// What the reads return or throw is left open, only that they come back.
function run(script: string): { status: number | null; stdout: string; } {
	const { spawnSync } = require('node:child_process');
	return spawnSync(
		process.execPath,
		['--max-old-space-size=64', '--input-type=module', '-e', `
			import { computed, endBatch, signal, startBatch } from ${JSON.stringify(new URL('../esm/index.mjs', import.meta.url).href)};
			const attempt = fn => { try { fn(); } catch { } };
			${script}
			console.log('done');
		`],
		{ timeout: 100_000, encoding: 'utf8' },
	);
}

const cases = Number(process.env.FUZZ_CASES ?? 1000);

test('computeds that never read each other in a circle', () => {
	const result = run(`
		const s = signal(0);
		const a = computed(() => s() + 1);
		const b = computed(() => a() + 1);
		attempt(b);
		s(1);
		attempt(b);
	`);

	expect(result.stdout).toBe('done\n');
	expect(result.status).toBe(0);
});

// Fails (#123): a computed that is read while its own getter is running is
// handed out like one that has a value, and the reader records it as a
// dependency. That closes a circle in the graph. checkDirty walks down
// through everything that may have changed and has no way to notice that it
// has been here before.
test.fails('two computeds that read each other', () => {
	const result = run(`
		const fieldA = signal(false);
		const fieldB = signal(false);
		const a = computed(() => b() !== true ? fieldA() : null);
		const b = computed(() => a() !== true ? fieldB() : null);
		attempt(a);
		attempt(b);
		fieldA(true);
		attempt(a);
		attempt(b);
	`);

	expect(result.stdout).toBe('done\n');
	expect(result.status).toBe(0);
});

test.fails('a computed that reads itself', () => {
	const result = run(`
		const s = signal(0);
		const c = computed(() => (c() ?? 0) + s());
		attempt(c);
		s(1);
		attempt(c);
	`);

	expect(result.stdout).toBe('done\n');
	expect(result.status).toBe(0);
});

// Fails for the same reason without any computed being read while it runs:
// `a` is running when it reads `b`, and `b` is checked against `a`, which
// looks unchanged at that moment. `b` is handed out as up to date and becomes
// a dependency of `a` while still depending on it.
test.fails('a computed that starts to read a computed that depends on it', () => {
	const result = run(`
		const s = signal(0);
		const flag = signal(false);
		const u = signal(0);
		const t = computed(() => u());
		const a = computed(() => flag() ? b() + t() : s());
		const b = computed(() => a() + 1);
		attempt(b);
		flag(true);
		attempt(a);
		u(1);
		attempt(a);
	`);

	expect(result.stdout).toBe('done\n');
	expect(result.status).toBe(0);
});

// 5 to 9 nodes: 2 to 4 signals, then computeds that add up 1 to 3 nodes
// picked from all of them, themselves included, and stop at the first odd
// sum. 20 steps: 50% one write of 0 to 3, 40% read a computed, 10% a batch of
// 1 to 3 writes.
test.fails('random computeds that read each other', { timeout: 120_000 }, () => {
	const result = run(`
		for (let seed = 1; seed <= ${cases}; seed++) {
			let state = seed;
			const rand = () => {
				state = (state + 0x6D2B79F5) >>> 0;
				let t = state;
				t = Math.imul(t ^ (t >>> 15), t | 1);
				t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
				return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
			};
			const int = n => Math.floor(rand() * n);
			const signals = Array.from({ length: 2 + int(3) }, () => signal(0));
			const computeds = [];
			const count = 2 + int(4);
			const read = i => i < signals.length ? signals[i]() : computeds[i - signals.length]();
			for (let i = 0; i < count; i++) {
				const srcs = Array.from({ length: 1 + int(3) }, () => int(signals.length + count));
				computeds.push(computed(() => {
					let v = 0;
					for (const src of srcs) {
						v += read(src) ?? 0;
						if (v % 2) break;
					}
					return v % 4;
				}));
			}
			const write = () => attempt(() => signals[int(signals.length)](int(4)));
			for (let step = 0; step < 20; step++) {
				const r = rand();
				if (r < 0.5) {
					write();
				} else if (r < 0.9) {
					attempt(computeds[int(count)]);
				} else {
					startBatch();
					for (let k = 1 + int(3); k > 0; k--) {
						write();
					}
					attempt(endBatch);
				}
			}
		}
	`);

	expect(result.stdout).toBe('done\n');
	expect(result.status).toBe(0);
});
