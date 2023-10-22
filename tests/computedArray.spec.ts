import { describe, expect, it, vi } from 'vitest';
import { computed, effect, signal } from '../src';
import { computedArray } from '../src/computeds/computedArray';

describe('computedArray', () => {
	it('should get updated item value', () => {
		const src = signal([1]);
		const arr = computedArray(src, (item) => {
			return computed(() => item() + 1);
		});
		expect(arr[0]).toBe(2);
	});

	it('should watch item value change', () => {
		const spy = vi.fn();
		const src = signal([1]);
		const arr = computedArray(src, (item) => {
			return computed(() => item() + 1);
		});
		effect(() => {
			spy();
			arr[0];
		});
		expect(spy).toHaveBeenCalledTimes(1);
		src.set([2]);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('should not trigger if item value did not change', () => {
		const spy = vi.fn();
		const src = signal([1]);
		const arr = computedArray(src, (item) => {
			return computed(() => item() + 1);
		});
		effect(() => {
			spy();
			arr[0];
		});
		expect(spy).toHaveBeenCalledTimes(1);
		src.set([1]);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('should not trigger first item computed if source item did not change', () => {
		const spy = vi.fn();
		const src = signal([1]);
		const arr = computedArray(src, (item, i) => {
			return computed(() => {
				if (i === 0) {
					spy();
				}
				return item() + 1;
			});
		});
		effect(() => arr[0]);
		expect(spy).toHaveBeenCalledTimes(1);
		src.set([1, 2]);
		expect(spy).toHaveBeenCalledTimes(1);
		src.set([2, 2, 3]);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('should watch length change', () => {
		const spy = vi.fn();
		const src = signal([1]);
		const arr = computedArray(src, (item) => {
			return computed(() => item() + 1);
		});
		effect(() => {
			spy();
			arr.length;
		});
		expect(spy).toHaveBeenCalledTimes(1);
		src.set([2]);
		expect(spy).toHaveBeenCalledTimes(1);
		src.set([2, 3]);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('should watch item remove', () => {
		const spy = vi.fn();
		const src = signal([1, 2]);
		const arr = computedArray(src, (item) => {
			return computed(() => item() + 1);
		});
		effect(() => {
			spy();
			arr[0];
		});
		expect(spy).toHaveBeenCalledTimes(1);
		src.set([1]);
		expect(spy).toHaveBeenCalledTimes(1);
		src.set([]);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('should only trigger access items', () => {
		const spy = vi.fn();
		const src = signal([1, 2, 3, 4]);
		const arr = computedArray(src, (item) => {
			return computed(() => {
				spy();
				return item() + 1;
			});
		});
		effect(() => {
			arr[0];
			arr[1];
		});
		expect(spy).toHaveBeenCalledTimes(2);
		src.set([2, 3, 4, 5]);
		expect(spy).toHaveBeenCalledTimes(4);
	});
});
