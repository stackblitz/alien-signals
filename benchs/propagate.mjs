import { bench, boxplot, run } from 'mitata';
import { computed, effect, signal } from '../esm/index.mjs';

boxplot(() => {
	bench('propagate: $w * $h', function* (state) {
		const w = state.get('w');
		const h = state.get('h');
		const src = signal(1);
		for (let i = 0; i < w; i++) {
			let last = src;
			for (let j = 0; j < h; j++) {
				const prev = last;
				last = computed(() => prev() + 1);
			}
			effect(() => last());
		}
		yield () => src(src() + 1);
	})
		.args('h', [1, 10, 100])
		.args('w', [1, 10, 100]);
});

run({ format: 'markdown' });
