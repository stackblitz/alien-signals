import { expect } from 'vitest';
import { test } from 'vitest';

declare function require(module: string): any;

test('build: cjs', () => {
	const index = require('../cjs/index.cjs');
	const system = require('../cjs/system.cjs');

	expect(typeof index.createReactiveSystem).toBe('function');
	expect(typeof system.createReactiveSystem).toBe('function');
});

test('build: esm', async () => {
	const index = await import('../esm/index.mjs');
	const system = await import('../esm/system.mjs');

	expect(typeof index.createReactiveSystem).toBe('function');
	expect(typeof system.createReactiveSystem).toBe('function');
});
