import { expect, test } from 'vitest';

declare function require(module: string): any;
declare const process: { execPath: string; };

// Runs against the build in a process of its own with a small heap: where
// this goes wrong it does not return, it allocates until the process dies.
// What the reads return or throw is left open, only that they come back.
function run(script: string): { status: number | null; stdout: string; } {
	const { spawnSync } = require('node:child_process');
	const url = new URL('../esm/index.mjs', import.meta.url).href;
	return spawnSync(
		process.execPath,
		['--max-old-space-size=64', '--input-type=module', '-e', `
			import { computed, signal } from ${JSON.stringify(url)};
			const attempt = fn => { try { fn(); } catch { } };
			${script}
			console.log('done');
		`],
		{ timeout: 20_000, encoding: 'utf8' },
	);
}

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
