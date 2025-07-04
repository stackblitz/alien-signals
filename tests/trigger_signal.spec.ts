import { expect, test } from 'vitest';
import { signal, effect, triggerSignal } from '../src';

test('should force trigger effect even when signal value unchanged', () => {
	const s = signal(42);
	let effectRunCount = 0;

	effect(() => {
		effectRunCount++;
		s();
	});

	expect(effectRunCount).toBe(1);

	triggerSignal(s);
	expect(effectRunCount).toBe(2);
});

test('should trigger multiple effects subscribed to the same signal', () => {
	const s = signal(100);
	let effect1Count = 0;
	let effect2Count = 0;

	effect(() => {
		effect1Count++;
		s();
	});

	effect(() => {
		effect2Count++;
		s();
	});

	expect(effect1Count).toBe(1);
	expect(effect2Count).toBe(1);

	triggerSignal(s);

	expect(effect1Count).toBe(2);
	expect(effect2Count).toBe(2);
});
