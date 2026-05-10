import { expect, test } from 'vitest';
import { computed, effect, effectScope, signal, trigger } from '../src';

test('#105 signal and computed should link to the same node in effectScope', () => {
	const a = signal(0);
	const b = computed(() => 0);
	let triggers = 0;

	effect(() => {
		triggers += 1;
		effectScope(() => {
			effectScope(() => {
				a();
				b();
			});
		});
	});

	expect(triggers).toBe(1);
	a(a() + 1);
	expect(triggers).toBe(2);
	trigger(b);
	expect(triggers).toBe(3);
});

test('#105 effect should respond to both signal and computed changes through scope', () => {
	const s = signal(0);
	const c = computed(() => s() * 2);
	let triggers = 0;

	effect(() => {
		triggers += 1;
		effectScope(() => {
			s();
			c();
		});
	});

	expect(triggers).toBe(1);

	s(1);
	expect(triggers).toBe(2);

	trigger(c);
	expect(triggers).toBe(3);
});

test('#105 scope should respond to consecutive signal updates', () => {
	const s = signal(0);
	let triggers = 0;

	effect(() => {
		triggers += 1;
		effectScope(() => {
			s();
		});
	});

	expect(triggers).toBe(1);
	s(1);
	expect(triggers).toBe(2);
	s(2);
	expect(triggers).toBe(3);
});

test('#105 computed in standalone scope should cache and clean up', () => {
	const s = signal(0);
	let computeCount = 0;

	const dispose = effectScope(() => {
		const c = computed(() => {
			computeCount++;
			return s();
		});
		expect(c()).toBe(0);
		expect(c()).toBe(0);
	});

	// Computed should cache (only 1 evaluation, not 2)
	expect(computeCount).toBe(1);

	dispose();
});
