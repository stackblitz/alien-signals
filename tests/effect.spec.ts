import { expect, test } from 'vitest';
import { computed, effect, endBatch, signal, startBatch } from '../src';

test('should clear subscriptions when untracked by all subscribers', () => {
	let bRunTimes = 0;

	const a = signal(1);
	const b = computed(() => {
		bRunTimes++;
		return a() * 2;
	});
	const stopEffect = effect(() => {
		b();
	});

	expect(bRunTimes).toBe(1);
	a(2);
	expect(bRunTimes).toBe(2);
	stopEffect();
	a(3);
	expect(bRunTimes).toBe(2);
});

test('should not run untracked inner effect', () => {
	const a = signal(3);
	const b = computed(() => a() > 0);

	effect(() => {
		if (b()) {
			effect(() => {
				if (a() == 0) {
					throw new Error("bad");
				}
			});
		}
	});

	decrement();
	decrement();
	decrement();

	function decrement() {
		a(a() - 1);
	}
});

test('should run outer effect first', () => {
	const a = signal(1);
	const b = signal(1);

	effect(() => {
		if (a()) {
			effect(() => {
				b();
				if (a() == 0) {
					throw new Error("bad");
				}
			});
		} else {
		}
	});

	startBatch();
	b(0);
	a(0);
	endBatch();
});

test('should not trigger inner effect when resolve maybe dirty', () => {
	const a = signal(0);
	const b = computed(() => a() % 2);

	let innerTriggerTimes = 0;

	effect(() => {
		effect(() => {
			b();
			innerTriggerTimes++;
			if (innerTriggerTimes >= 2) {
				throw new Error("bad");
			}
		});
	});

	a(2);
});

test('should trigger inner effects in sequence', () => {
	const a = signal(0);
	const b = signal(0);
	const c = computed(() => a() - b());
	const order: string[] = [];

	effect(() => {
		c();

		effect(() => {
			order.push('first inner');
			a();
		});

		effect(() => {
			order.push('last inner');
			a();
			b();
		});
	});

	order.length = 0;

	startBatch();
	b(1);
	a(1);
	endBatch();

	expect(order).toEqual(['first inner', 'last inner']);
});
