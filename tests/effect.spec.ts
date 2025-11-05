import { expect, test } from 'vitest';
import { computed, effect, effectScope, endBatch, getActiveSub, setActiveSub, signal, startBatch } from '../src';
import { ReactiveFlags } from '../src/system';

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

test('should notify inner effects in the same order as non-inner effects', () => {
	const a = signal(0);
	const b = signal(0);
	const c = computed(() => a() - b());
	const order1: string[] = [];
	const order2: string[] = [];
	const order3: string[] = [];

	effect(() => {
		order1.push('effect1');
		a();
	});
	effect(() => {
		order1.push('effect2');
		a();
		b();
	});

	effect(() => {
		c();
		effect(() => {
			order2.push('effect1');
			a();
		});
		effect(() => {
			order2.push('effect2');
			a();
			b();
		});
	});

	effectScope(() => {
		effect(() => {
			order3.push('effect1');
			a();
		});
		effect(() => {
			order3.push('effect2');
			a();
			b();
		});
	});

	order1.length = 0;
	order2.length = 0;
	order3.length = 0;

	startBatch();
	b(1);
	a(1);
	endBatch();

	expect(order1).toEqual(['effect2', 'effect1']);
	expect(order2).toEqual(order1);
	expect(order3).toEqual(order1);
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
		const currentSub = setActiveSub();
		const isOne = src2() === 1;
		setActiveSub(currentSub);
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

test('should handle effect recursion for the first execution', () => {
	const src1 = signal(0);
	const src2 = signal(0);

	let triggers1 = 0;
	let triggers2 = 0;

	effect(() => {
		triggers1++;
		src1(Math.min(src1() + 1, 5));
	});
	effect(() => {
		triggers2++;
		src2(Math.min(src2() + 1, 5));
		src2();
	});

	expect(triggers1).toBe(1);
	expect(triggers2).toBe(1);
});

test('should support custom recurse effect', () => {
	const src = signal(0);

	let triggers = 0;

	effect(() => {
		getActiveSub()!.flags &= ~ReactiveFlags.RecursedCheck;
		triggers++;
		src(Math.min(src() + 1, 5));
	});

	expect(triggers).toBe(6);
});
