import { expect, test } from 'vitest';
import { computed, effect, endBatch, signal, startBatch } from '../src';

const attempt = (fn: () => void) => {
	try {
		fn();
	} catch { }
};

// What an exception leaves behind. None of these say what a read or a write
// should do while something throws, or which effects still run in a flush
// that fails, only that it is over once the cause is gone: a later change
// still reaches whoever depends on it.

test('an effect that threw runs again', () => {
	const a = signal(0);
	const seen: number[] = [];

	effect(() => {
		seen.push(a());
		if (a() === 1) {
			throw new Error('one');
		}
	});
	attempt(() => a(1));
	a(2);

	expect(seen.pop()).toBe(2);
});

test('an effect skipped because another one threw runs on the next write', () => {
	const a = signal(0);
	const seen: number[] = [];

	effect(() => {
		if (a() === 1) {
			throw new Error('one');
		}
	});
	effect(() => { seen.push(a()); });
	attempt(() => a(1));
	a(2);

	expect(seen.pop()).toBe(2);
});

// Fails: the effect was taken off the queue to run, and the getter threw
// while its dependencies were being checked, before the part of run() that
// marks it as watching again. It is neither queued nor watching, and no
// write can queue it any more.
test.fails('an effect runs again after a getter it depends on threw', () => {
	const a = signal(1);
	const seen: number[] = [];
	const c = computed(() => {
		if (a() === 0) {
			throw new Error('zero');
		}
		return a();
	});

	effect(() => { seen.push(c()); });
	attempt(() => a(0));
	a(2);

	expect(seen.pop()).toBe(2);
});

// Fails: the second effect is dropped from the queue when the first throws.
// The computed between it and the signal stays marked as possibly changed,
// which stops later writes from travelling past it to the effect.
test.fails('an effect behind a computed, skipped because another one threw, runs on the next write', () => {
	const a = signal(0);
	const seen: number[] = [];
	const c = computed(() => a() + 1);

	effect(() => {
		if (a() === 1) {
			throw new Error('one');
		}
	});
	effect(() => { seen.push(c()); });
	attempt(() => a(1));
	a(2);

	expect(seen.pop()).toBe(3);
});

// Fails: a read that throws leaves before the dependency is recorded. The
// reader's getter ends there, so the reader is left without that dependency
// and is marked as up to date.
test.fails('a computed notices a change in a getter that threw while it was reading it', () => {
	const a = signal(1);
	const b = signal(0);
	const inner = computed(() => {
		if (a() === 0) {
			throw new Error('zero');
		}
		return a();
	});
	const outer = computed(() => b() + inner());

	expect(outer()).toBe(1);
	a(0);
	b(1);
	attempt(outer);
	a(5);

	expect(outer()).toBe(6);
});

test.fails('an effect notices a change in a getter that threw while it was reading it', () => {
	const a = signal(1);
	const b = signal(0);
	const seen: number[] = [];
	const c = computed(() => {
		if (a() === 0) {
			throw new Error('zero');
		}
		return a();
	});

	effect(() => {
		b();
		seen.push(c());
	});
	startBatch();
	a(0);
	b(1);
	attempt(endBatch);
	a(5);

	expect(seen.pop()).toBe(5);
});

// Fails: the check that walks from a reader up to what changed is abandoned
// where the getter throws. The computed it had passed stays marked as
// possibly changed while the reader ends up marked as up to date, and a later
// write stops at the first node that is marked already.
test.fails('a computed notices a change in a getter that threw two levels up', () => {
	const a = signal(1);
	const b = signal(0);
	const inner = computed(() => {
		if (a() === 0) {
			throw new Error('zero');
		}
		return a();
	});
	const mid = computed(() => inner());
	const outer = computed(() => b() + mid());

	expect(outer()).toBe(1);
	a(0);
	b(1);
	attempt(outer);
	a(5);

	expect(outer()).toBe(6);
});

test.fails('an effect notices a change in a getter that threw two levels up', () => {
	const a = signal(1);
	const b = signal(0);
	const seen: number[] = [];
	const inner = computed(() => {
		if (a() === 0) {
			throw new Error('zero');
		}
		return a();
	});
	const mid = computed(() => inner());

	effect(() => {
		b();
		seen.push(mid());
	});
	startBatch();
	a(0);
	b(1);
	attempt(endBatch);
	a(5);

	expect(seen.pop()).toBe(5);
});
