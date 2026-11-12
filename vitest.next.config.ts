import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const next = fileURLToPath(new URL('./next/index.ts', import.meta.url));

// Runs the suites written for `src` against `next` as well, next to its own.
export default defineConfig({
	resolve: {
		alias: [{ find: /^\.\.\/src(\/system)?$/, replacement: next }],
	},
	test: {
		include: ['tests/*.spec.ts', 'next/tests/*.spec.ts'],
		exclude: ['tests/build.spec.ts'],
		execArgv: ['--expose-gc'],
	},
});
