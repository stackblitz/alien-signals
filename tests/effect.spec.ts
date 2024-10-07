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

test('should not run untracked inner effect', () => {
	const msg = signal(3);
	const c = computed(() => msg.get() > 0);

	effect(() => {
		if (c.get()) {
			effect(() => {
				// console.log("inner", msg.get());
				if (msg.get() == 0) {
					throw new Error("bad");
				}
			});
		} else {
			// console.log("inner shouldn't run");
		}
	});

	decrement();
	decrement();
	decrement();

	function decrement() {
		msg.set(msg.get() - 1);
	}
});
