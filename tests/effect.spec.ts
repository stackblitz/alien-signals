import { expect, test } from 'vitest';
import { computed, effect, signal, Subscriber } from '..';

test('should clear subscriptions when untracked by all subscribers', () => {
	const src = signal(1);
	const double = computed(() => src.get() * 2);
	const effect1 = effect(() => {
		double.get();
	});

	expect(!!double.subs).toBe(true);
	Subscriber.clearTrack(effect1);
	expect(!!double.subs).toBe(false);
});
