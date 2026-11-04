import { existsSync } from 'node:fs';
import { expect } from 'vitest';
import { test } from 'vitest';

declare function require(module: string): any;

test('build: cjs', () => {
	const index = require('../cjs/index.cjs');
	const system = require('../cjs/system.cjs');

	expect(typeof index.getActiveSub).toBe('function');
	expect(typeof system.createReactiveSystem).toBe('function');
});

test('build: esm', async () => {
	const index = await import('../esm/index.mjs');
	const system = await import('../esm/system.mjs');

	expect(typeof index.getActiveSub).toBe('function');
	expect(typeof system.createReactiveSystem).toBe('function');
});

test('build: entry fields', () => {
	const pkg = require('../package.json');
	const root = new URL('../', import.meta.url);

	// Resolvers that predate `exports`, such as webpack 4, only see these.
	expect(pkg.main).toBe('./cjs/index.cjs');
	expect(pkg.module).toBe('./esm/index.mjs');

	const entries: string[] = [pkg.main, pkg.module, pkg.types];
	for (const conditions of Object.values(pkg.exports)) {
		entries.push(...Object.values(conditions as Record<string, string>));
	}

	for (const entry of entries) {
		expect(existsSync(new URL(entry, root)), entry).toBe(true);
	}
});
