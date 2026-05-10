import { test } from 'vitest';
import { computed, effect, signal } from '../src';

test('#109', () => {
	const s = signal(false);
	let dispose!: () => void;
	const a = computed(() => {
		if (s()) dispose();
		return 0;
	});
	const b = computed(() => a());
	dispose = effect(() => { b(); });
	s(true);
});
