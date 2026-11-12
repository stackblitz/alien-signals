// Time per step of each workload, for comparing builds.
//
//   node benchs/wallclock.mjs <dir>... [--jitless] [--only grid,read]
//
// <dir> holds a build (index.mjs), `esm` by default. Every build gets 9
// processes, started in alternating order so that drift affects all of them
// alike. A process warms up, times 15 rounds and reports its median round;
// the table shows the median and the best of those 9 medians, in nanoseconds.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { workloads } from './workloads.mjs';

const self = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

if (args[0] === '--worker') {
	const [, lib, name, steps] = args;
	const step = workloads[name](await import(pathToFileURL(resolve(lib, 'index.mjs')).href));
	const n = Number(steps);
	for (let i = 0; i < n; i++) {
		step();
	}
	const rounds = [];
	for (let r = 0; r < 15; r++) {
		const start = process.hrtime.bigint();
		for (let i = 0; i < n; i++) {
			step();
		}
		rounds.push(Number(process.hrtime.bigint() - start) / n);
	}
	rounds.sort((a, b) => a - b);
	console.log(rounds[rounds.length >> 1]);
} else {
	const jitless = args.includes('--jitless');
	if (jitless) {
		args.splice(args.indexOf('--jitless'), 1);
	}
	const onlyAt = args.indexOf('--only');
	const only = onlyAt < 0 ? Object.keys(workloads) : args.splice(onlyAt, 2)[1].split(',');
	const dirs = args.length ? args : ['esm'];
	const steps = jitless ? 2000 : 20000;

	console.log(['workload', ...dirs.flatMap(dir => [dir + ' median', dir + ' best'])].join('\t'));
	for (const name of only) {
		const medians = dirs.map(() => []);
		for (let p = 0; p < 9; p++) {
			for (let k = 0; k < dirs.length; k++) {
				const d = p % 2 ? dirs.length - 1 - k : k;
				const out = execFileSync(process.execPath, [...(jitless ? ['--jitless'] : []), self, '--worker', dirs[d], name, String(steps)]);
				medians[d].push(Number(out));
			}
		}
		const row = medians.flatMap(m => {
			m.sort((a, b) => a - b);
			return [m[m.length >> 1].toFixed(1), m[0].toFixed(1)];
		});
		console.log([name, ...row].join('\t'));
	}
}
