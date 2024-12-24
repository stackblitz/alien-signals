import { expect, test } from 'vitest';
import { checkDirty, Computed, shallowPropagate, SubscriberFlags } from '../src';
import { computed, effect, effectScope, endBatch, signal, startBatch } from './api';

test('should clear subscriptions when untracked by all subscribers', () => {
	let bRunTimes = 0;

	const a = signal(1);
	const b = computed(() => {
		bRunTimes++;
		return a.get() * 2;
	});
	const effect1 = effect(() => {
		b.get();
	});

	expect(bRunTimes).toBe(1);
	a.set(2);
	expect(bRunTimes).toBe(2);
	effect1.stop();
	a.set(3);
	expect(bRunTimes).toBe(2);
});

test('should not run untracked inner effect', () => {
	const a = signal(3);
	const b = computed(() => a.get() > 0);

	effect(() => {
		if (b.get()) {
			effect(() => {
				if (a.get() == 0) {
					throw new Error("bad");
				}
			});
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
		if (a.get()) {
			effect(() => {
				b.get();
				if (a.get() == 0) {
					throw new Error("bad");
				}
			});
		} else {
		}
	});

	startBatch();
	b.set(0);
	a.set(0);
	endBatch();
});

test('should not trigger inner effect when resolve maybe dirty', () => {
	const a = signal(0);
	const b = computed(() => a.get() % 2);

	let innerTriggerTimes = 0;

	effect(() => {
		effect(() => {
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
	const c = computed(() => a.get() - b.get());
	const order: string[] = [];

	effect(() => {
		c.get();

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

	startBatch();
	b.set(1);
	a.set(1);
	endBatch();

	expect(order).toEqual(['first inner', 'last inner']);
});

test('should trigger inner effects in sequence in effect scope', () => {
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

	startBatch();
	b.set(1);
	a.set(1);
	endBatch();

	expect(order).toEqual(['first inner', 'last inner']);
});

test('should custom computed support recursion', () => {
	class RecursiveComputed<T> extends Computed<T> {
		get(): T {
			let flags = this.flags;
			if (flags & SubscriberFlags.Dirty) {
				if (this.update()) {
					const subs = this.subs;
					if (subs !== undefined) {
						shallowPropagate(subs);
					}
				}
			} else if (flags & SubscriberFlags.ToCheckDirty) {
				if (checkDirty(this.deps!)) {
					if (this.update()) {
						const subs = this.subs;
						if (subs !== undefined) {
							shallowPropagate(subs);
						}
					}
				} else {
					this.flags = flags & ~SubscriberFlags.ToCheckDirty;
				}
			}
			flags = this.flags;
			if (flags & SubscriberFlags.Recursed) {
				this.flags = flags & ~SubscriberFlags.Recursed;
				return this.get();
			}
			return super.get();
		}
	}

	const logs: string[] = [];
	const a = signal(0);
	const b = new RecursiveComputed(() => {
		if (a.get() === 0) {
			logs.push('b-0');
			a.set(100);
			logs.push('b-1 ' + a.get());
			a.set(200);
			logs.push('b-2 ' + a.get());
		} else {
			logs.push('b-2 ' + a.get());
		}
	});

	effect(() => {
		b.get();
	});

	expect(logs).toEqual(['b-0', 'b-1 100', 'b-2 200', 'b-2 200']);
});
