import { expect, test } from 'vitest';

declare function require(module: string): any;

test('build: cjs', () => {
	const index = require("alien-signals");
	const system = require('alien-signals/system');

	expect(typeof index.createReactiveSystem).toBe('function');
	expect(typeof system.createReactiveSystem).toBe('function');
});

test('build: esm', async () => {
	const index = await import('alien-signals');
	const system = await import('alien-signals/system');

	expect(typeof index.createReactiveSystem).toBe('function');
	expect(typeof system.createReactiveSystem).toBe('function');
});
