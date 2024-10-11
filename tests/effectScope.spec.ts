import { expect, test } from 'vitest';
import { effect, effectScope, signal } from '..';

test.skip('should not trigger after stop', () => {
	const count = signal(1);
	const scope = effectScope();

	let triggers = 0;
	let effect1;

	scope.run(() => {
		effect1 = effect(() => {
			triggers++;
			count.get();
		});
	});

	expect(triggers).toBe(1);
	count.set(2);
	expect(triggers).toBe(2);
	scope.stop();
	count.set(3);
	expect(triggers).toBe(2);
});
