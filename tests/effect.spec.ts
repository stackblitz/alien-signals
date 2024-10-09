import { expect, test } from 'vitest';
import { computed, effect, signal, Subscriber, System } from '..';

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
		// console.log("outer");
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

test('should run outer effect first', () => {
	const a = signal(1);
	const b = signal(1);

	effect(() => {
		// console.log("outer");
		if (a.get()) {
			effect(() => {
				// console.log("inner");
				b.get();
				if (a.get() == 0) {
					throw new Error("bad");
				}
			});
		} else {
			// console.log("inner shouldn't run");
		}
	});

	System.startBatch();
	b.set(0);
	a.set(0);
	System.endBatch();
});

test('should not trigger inner effect when resolve maybe dirty', () => {
	const a = signal(0);
	const b = computed(() => a.get() % 2);

	let innerTriggerTimes = 0;

	effect(() => {
		// console.log("outer");
		effect(() => {
			// console.log("inner");
			b.get();
			innerTriggerTimes++;
			if (innerTriggerTimes > 1) {
				throw new Error("bad");
			}
		});
	});

	a.set(2);
});

test('should trigger inner effects in sequence', () => {
	const a = signal(0);
	const b = signal(0);
	const order: string[] = [];

	effect(() => {

		effect(() => {
			order.push('first inner');
			a.get();
		});

		effect(() => {
			order.push('last inner');
			a.get();
			b.get();
		});
	});

	order.length = 0;

	System.startBatch();
	b.set(1);
	a.set(1);
	System.endBatch();

	expect(order).toEqual(['first inner', 'last inner']);
});
