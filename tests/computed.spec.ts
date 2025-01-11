import { expect, test } from 'vitest';
import { Computed, SubscriberFlags, updateComputed } from '../src';
import { computed, signal } from './api';
import { isDirty, shallowPropagate } from '../src/internal';

test('should correctly propagate changes through computed signals', () => {
	const src = signal(0);
	const c1 = computed(() => src.get() % 2);
	const c2 = computed(() => c1.get());
	const c3 = computed(() => c2.get());

	c3.get();
	src.set(1); // c1 -> dirty, c2 -> toCheckDirty, c3 -> toCheckDirty
	c2.get(); // c1 -> none, c2 -> none
	src.set(3); // c1 -> dirty, c2 -> toCheckDirty

	expect(c3.get()).toBe(1);
});

test('should custom computed support recursion', () => {
	class RecursiveComputed<T> extends Computed<T> {
		get(): T {
			const flags = this.flags;
			if (
				flags & (SubscriberFlags.ToCheckDirty | SubscriberFlags.Dirty)
				&& isDirty(this, flags)
			) {
				if (updateComputed(this)) {
					const subs = this.subs;
					if (subs !== undefined) {
						shallowPropagate(subs);
					}
				}
			}
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

	b.get();

	expect(logs).toEqual(['b-0', 'b-1 100', 'b-2 200', 'b-2 200']);
});
