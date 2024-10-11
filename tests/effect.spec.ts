import { expect, test } from 'vitest';
import { computed, effect, effectScope, signal, Subscriber, System } from '..';

test('should clear subscriptions when untracked by all subscribers', () => {
	const a = signal(1);
	const b = computed(() => {
		return a.get() * 2;
	});
	const effect1 = effect(() => {
		b.get();
	});


	expect(!!b.subs).toBe(true);
	Subscriber.clearTrack(effect1);
	expect(!!b.subs).toBe(false);
});

test('should not run untracked inner effect', () => {
	const a = signal(3);
	const b = computed(() => a.get() > 0);

	effect(() => {
		// console.log("outer");
		if (b.get()) {
			effect(() => {
				// console.log("inner", msg.get());
				if (a.get() == 0) {
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
		a.set(a.get() - 1);
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

test.skip('should trigger inner effects in sequence', () => {
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

test.skip('should trigger inner effects in sequence in effect scope', () => {
	const a = signal(0);
	const b = signal(0);
	const scope = effectScope();
	const order: string[] = [];

	scope.run(() => {

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
