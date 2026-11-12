// Instructions executed per step of each workload, as counted by valgrind
// while node interprets the build without a JIT. Repeated runs agree to
// within a few tens of instructions, so small differences between two builds
// can be told apart, which timing cannot do.
//
//   node benchs/instructions.mjs <dir>... [--only grid,read]
//
// <dir> holds a build (index.mjs), `esm` by default. Linux only; needs
// valgrind and setarch. Each number is the slope between runs of 300 and 600
// steps, which leaves out start-up and the one-time cost of compiling to
// bytecode.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workloads } from './workloads.mjs';

const self = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

if (args[0] === '--worker') {
	const [, lib, name, steps] = args;
	const step = workloads[name](await import(pathToFileURL(resolve(lib, 'index.mjs')).href));
	for (let i = Number(steps); i > 0; i--) {
		step();
	}
} else {
	const onlyAt = args.indexOf('--only');
	const only = onlyAt < 0 ? Object.keys(workloads) : args.splice(onlyAt, 2)[1].split(',');
	const dirs = args.length ? args : ['esm'];

	// valgrind reports on stderr
	const run = (dir, name, steps) => {
		const out = execFileSync('sh', ['-c', 'exec "$@" 2>&1 >/dev/null', 'sh',
			'setarch', '-R', 'valgrind', '--tool=cachegrind', '--cache-sim=no', '--cachegrind-out-file=/dev/null',
			process.execPath, '--jitless', '--predictable', '--single-threaded', '--hash-seed=42', '--random-seed=42',
			self, '--worker', dir, name, String(steps),
		]).toString();
		const refs = /I\s+refs:\s+([\d,]+)/.exec(out);
		if (refs === null) {
			throw new Error(out);
		}
		return Number(refs[1].replaceAll(',', ''));
	};

	console.log(['workload', ...dirs].join('\t'));
	for (const name of only) {
		const row = dirs.map(dir => Math.round((run(dir, name, 600) - run(dir, name, 300)) / 300));
		console.log([name, ...row].join('\t'));
	}
}
