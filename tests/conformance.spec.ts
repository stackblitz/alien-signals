import { describe, test } from 'vitest';
import { testSuite, SkipTest, type ReactiveFramework } from 'reactive-framework-test-suite';
import { signal, computed, effect, effectScope, startBatch, endBatch, setActiveSub } from '../src';

const framework: ReactiveFramework = {
	signal(initialValue) {
		const s = signal(initialValue);
		return {
			read: () => s(),
			write: (v) => s(v),
		};
	},
	computed(fn) {
		const c = computed(fn);
		return { read: () => c() };
	},
	effect(fn) {
		return effect(fn);
	},
	run(fn) {
		effectScope(fn)();
	},
	batch(fn) {
		startBatch();
		try {
			fn();
		} finally {
			endBatch();
		}
	},
	untracked(fn) {
		const prev = setActiveSub(undefined);
		try {
			return fn();
		} finally {
			setActiveSub(prev);
		}
	},
};

for (const { section, cases } of testSuite) {
	describe(section, () => {
		for (const [name, fn] of Object.entries(cases)) {
			test(name, () => {
				try {
					framework.run(() => fn(framework));
				} catch (e) {
					if (e instanceof SkipTest) return;
					throw e;
				}
			});
		}
	});
}
