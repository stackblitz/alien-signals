import { expect, test } from 'vitest';
import { effect, effectScope, signal } from '../src';

test('should not trigger after stop', () => {
	const count = signal(1);

	let triggers = 0;
	let effect1;

	const stopScope = effectScope(() => {
		effect1 = effect(() => {
			triggers++;
			count();
		});
		expect(triggers).toBe(1);

		count(2);
	});

	expect(triggers).toBe(2);
	count(3);
	expect(triggers).toBe(3);
	stopScope();
	count(4);
	expect(triggers).toBe(3);
});
