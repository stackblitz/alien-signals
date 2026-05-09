import { test } from 'vitest';
import { computed, effect, signal } from '../src';

test('#109 variant - dep.subs undefined at line 190', () => {
	const s = signal(0);
	let dispose!: () => void;
	const a = computed(() => (s(), 0));                 // value never changes
	const a2 = computed(() => (s() && dispose(), s())); // disposes mid-update, value changes
	const b = computed(() => (a(), a2(), 0));            // reads a before a2
	dispose = effect(() => { b(); });
	s(1);
});
