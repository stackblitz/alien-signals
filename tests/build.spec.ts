import { expect } from 'vitest';
import { test } from 'vitest';

test('build: cjs', () => {
	const index = require('../cjs/index.cjs');
	const system = require('../cjs/system.cjs');

	expect(typeof index.createReactiveSystem).toBe('function');
	expect(typeof system.createReactiveSystem).toBe('function');
});

test('build: esm', () => {
	const index = require('../esm/index.mjs');
	const system = require('../esm/system.mjs');

	expect(typeof index.createReactiveSystem).toBe('function');
	expect(typeof system.createReactiveSystem).toBe('function');
});
