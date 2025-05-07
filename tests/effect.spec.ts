import { expect, test } from 'vitest';
import { computed, effect, effectScope, endBatch, setCurrentSub, signal, startBatch } from '../src';

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

	a(2);
	a(1);
	a(0);
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

test('should trigger inner effects in sequence in effect scope', () => {
	const a = signal(0);
	const b = signal(0);
	const order: string[] = [];

	effectScope(() => {

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

test('should custom effect support batch', () => {
	function batchEffect(fn: () => void) {
		return effect(() => {
			startBatch();
			try {
				return fn();
			} finally {
				endBatch();
			}
		});
	}

	const logs: string[] = [];
	const a = signal(0);
	const b = signal(0);

	const aa = computed(() => {
		logs.push('aa-0');
		if (!a()) {
			b(1);
		}
		logs.push('aa-1');
	});

	const bb = computed(() => {
		logs.push('bb');
		return b();
	});

	batchEffect(() => {
		bb();
	});
	batchEffect(() => {
		aa();
	});

	expect(logs).toEqual(['bb', 'aa-0', 'aa-1', 'bb']);
});

test('should duplicate subscribers do not affect the notify order', () => {
	const src1 = signal(0);
	const src2 = signal(0);
	const order: string[] = [];

	effect(() => {
		order.push('a');
		const currentSub = setCurrentSub(undefined);
		const isOne = src2() === 1;
		setCurrentSub(currentSub);
		if (isOne) {
			src1();
		}
		src2();
		src1();
	});
	effect(() => {
		order.push('b');
		src1();
	});
	src2(1); // src1.subs: a -> b -> a

	order.length = 0;
	src1(src1() + 1);

	expect(order).toEqual(['a', 'b']);
});

test('should handle side effect with inner effects', () => {
	const a = signal(0);
	const b = signal(0);
	const order: string[] = [];

	effect(() => {
		effect(() => {
			a();
			order.push('a');
		});
		effect(() => {
			b();
			order.push('b');
		});
		expect(order).toEqual(['a', 'b']);

		order.length = 0;
		b(1);
		a(1);
		expect(order).toEqual(['b', 'a']);
	});
});

test('should handle flags are indirectly updated during checkDirty', () => {
	const a = signal(false);
	const b = computed(() => a());
	const c = computed(() => {
		b();
		return 0;
	});
	const d = computed(() => {
		c();
		return b();
	});

	let triggers = 0;

	effect(() => {
		d();
		triggers++;
	});
	expect(triggers).toBe(1);
	a(true);
	expect(triggers).toBe(2);
});
