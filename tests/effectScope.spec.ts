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
		expect(triggers).toBe(2);
	});

	count(3);
	expect(triggers).toBe(3);
	stopScope();
	count(4);
	expect(triggers).toBe(3);
});

test('should dispose inner effects if created in an effect', () => {
	const source = signal(1);

	let triggers = 0;

	effect(() => {
		const dispose = effectScope(() => {
			effect(() => {
				source();
				triggers++;
			});
		});
		expect(triggers).toBe(1);

		source(2);
		expect(triggers).toBe(2);
		dispose();
		source(3);
		expect(triggers).toBe(2);
	});
});
