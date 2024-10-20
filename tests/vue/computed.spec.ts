import { expect, it, test, vi } from "vitest";
import { Computed, DirtyLevels } from "../../src";
import { computed, effect, pauseTracking, resetTracking, shallowRef } from "../../src/unstable/vue";

it('should return updated value', () => {
	const value = shallowRef<number>();
	const cValue = computed(() => value.value);
	expect(cValue.value).toBe(undefined);
	value.value = 1;
	expect(cValue.value).toBe(1);
});

it('should compute lazily', () => {
	const value = shallowRef<number>();
	const getter = vi.fn(() => value.value);
	const cValue = computed(getter);

	// lazy
	expect(getter).not.toHaveBeenCalled();

	expect(cValue.value).toBe(undefined);
	expect(getter).toHaveBeenCalledTimes(1);

	// should not compute again
	cValue.value;
	expect(getter).toHaveBeenCalledTimes(1);

	// should not compute until needed
	value.value = 1;
	expect(getter).toHaveBeenCalledTimes(1);

	// now it should compute
	expect(cValue.value).toBe(1);
	expect(getter).toHaveBeenCalledTimes(2);

	// should not compute again
	cValue.value;
	expect(getter).toHaveBeenCalledTimes(2);
});

it('should trigger effect', () => {
	const value = shallowRef<number>();
	const cValue = computed(() => value.value);
	let dummy;
	effect(() => {
		dummy = cValue.value;
	});
	expect(dummy).toBe(undefined);
	value.value = 1;
	expect(dummy).toBe(1);
});

it('should work when chained', () => {
	const value = shallowRef(0);
	const c1 = computed(() => value.value);
	const c2 = computed(() => c1.value + 1);
	expect(c2.value).toBe(1);
	expect(c1.value).toBe(0);
	value.value++;
	expect(c2.value).toBe(2);
	expect(c1.value).toBe(1);
});

it('should trigger effect when chained', () => {
	const value = shallowRef(0);
	const getter1 = vi.fn(() => value.value);
	const getter2 = vi.fn(() => {
		return c1.value + 1;
	});
	const c1 = computed(getter1);
	const c2 = computed(getter2);

	let dummy;
	effect(() => {
		dummy = c2.value;
	});
	expect(dummy).toBe(1);
	expect(getter1).toHaveBeenCalledTimes(1);
	expect(getter2).toHaveBeenCalledTimes(1);
	value.value++;
	expect(dummy).toBe(2);
	// should not result in duplicate calls
	expect(getter1).toHaveBeenCalledTimes(2);
	expect(getter2).toHaveBeenCalledTimes(2);
});

it('should trigger effect when chained (mixed invocations)', () => {
	const value = shallowRef(0);
	const getter1 = vi.fn(() => value.value);
	const getter2 = vi.fn(() => {
		return c1.value + 1;
	});
	const c1 = computed(getter1);
	const c2 = computed(getter2);

	let dummy;
	effect(() => {
		dummy = c1.value + c2.value;
	});
	expect(dummy).toBe(1);

	expect(getter1).toHaveBeenCalledTimes(1);
	expect(getter2).toHaveBeenCalledTimes(1);
	value.value++;
	expect(dummy).toBe(3);
	// should not result in duplicate calls
	expect(getter1).toHaveBeenCalledTimes(2);
	expect(getter2).toHaveBeenCalledTimes(2);
});

it('should support setter', () => {
	const n = shallowRef(1);
	const plusOne = computed({
		get: () => n.value + 1,
		set: val => {
			n.value = val - 1;
		},
	});

	expect(plusOne.value).toBe(2);
	n.value++;
	expect(plusOne.value).toBe(3);

	plusOne.value = 0;
	expect(n.value).toBe(-1);
});

it('should trigger effect w/ setter', () => {
	const n = shallowRef(1);
	const plusOne = computed({
		get: () => n.value + 1,
		set: val => {
			n.value = val - 1;
		},
	});

	let dummy;
	effect(() => {
		dummy = n.value;
	});
	expect(dummy).toBe(1);

	plusOne.value = 0;
	expect(dummy).toBe(-1);
});

// #5720
it('should invalidate before non-computed effects', () => {
	let plusOneValues: number[] = [];
	const n = shallowRef(0);
	const plusOne = computed(() => n.value + 1);
	effect(() => {
		n.value;
		plusOneValues.push(plusOne.value);
	});
	// access plusOne, causing it to be non-dirty
	plusOne.value;
	// mutate n
	n.value++;
	// on the 2nd run, plusOne.value should have already updated.
	expect(plusOneValues).toMatchObject([1, 2]);
});

// #5720
it('should invalidate before non-computed computeds', () => {
	let plusOneValues: number[] = [];
	const n = shallowRef(0);
	const plusOne = computed(() => n.value + 1);
	const c = computed(() => {
		n.value;
		plusOneValues.push(plusOne.value);
	});
	c.value;
	// access plusOne, causing it to be non-dirty
	plusOne.value;
	// mutate n
	n.value++;
	c.value;
	// on the 2nd run, plusOne.value should have already updated.
	expect(plusOneValues).toMatchObject([1, 2]);
});

// https://github.com/vuejs/core/pull/5912#issuecomment-1497596875
it('should query deps dirty sequentially', () => {
	const cSpy = vi.fn();

	const a = shallowRef<null | { v: number; }>({
		v: 1,
	});
	const b = computed(() => {
		return a.value;
	});
	const c = computed(() => {
		cSpy();
		return b.value?.v;
	});
	const d = computed(() => {
		if (b.value) {
			return c.value;
		}
		return 0;
	});

	d.value;
	a.value!.v = 2;
	a.value = null;
	d.value;
	expect(cSpy).toHaveBeenCalledTimes(1);
});

// https://github.com/vuejs/core/pull/5912#issuecomment-1738257692
it('chained computed dirty reallocation after querying dirty', () => {
	let _msg: string | undefined;

	const items = shallowRef<number[]>();
	const isLoaded = computed(() => {
		return !!items.value;
	});
	const msg = computed(() => {
		if (isLoaded.value) {
			return 'The items are loaded';
		} else {
			return 'The items are not loaded';
		}
	});

	effect(() => {
		_msg = msg.value;
	});

	items.value = [1, 2, 3];
	items.value = [1, 2, 3];
	items.value = undefined;

	expect(_msg).toBe('The items are not loaded');
});

it('chained computed dirty reallocation after trigger computed getter', () => {
	let _msg: string | undefined;

	const items = shallowRef<number[]>();
	const isLoaded = computed(() => {
		return !!items.value;
	});
	const msg = computed(() => {
		if (isLoaded.value) {
			return 'The items are loaded';
		} else {
			return 'The items are not loaded';
		}
	});

	_msg = msg.value;
	items.value = [1, 2, 3];
	isLoaded.value; // <- trigger computed getter
	_msg = msg.value;
	items.value = undefined;
	_msg = msg.value;

	expect(_msg).toBe('The items are not loaded');
});

// https://github.com/vuejs/core/pull/5912#issuecomment-1739159832
it('deps order should be consistent with the last time get value', () => {
	const cSpy = vi.fn();

	const a = shallowRef(0);
	const b = computed(() => {
		return a.value % 3 !== 0;
	});
	const c = computed(() => {
		cSpy();
		if (a.value % 3 === 2) {
			return 'expensive';
		}
		return 'cheap';
	});
	const d = computed(() => {
		return a.value % 3 === 2;
	});
	const e = computed(() => {
		if (b.value) {
			if (d.value) {
				return 'Avoiding expensive calculation';
			}
		}
		return c.value;
	});

	e.value;
	a.value++;
	e.value;

	expect(cSpy).toHaveBeenCalledTimes(2);

	a.value++;
	e.value;

	expect(cSpy).toHaveBeenCalledTimes(2);
});

it('should trigger by the second computed that maybe dirty', () => {
	const cSpy = vi.fn();

	const src1 = shallowRef(0);
	const src2 = shallowRef(0);
	const c1 = computed(() => src1.value);
	const c2 = computed(() => (src1.value % 2) + src2.value);
	const c3 = computed(() => {
		cSpy();
		c1.value;
		c2.value;
	});

	c3.value;
	src1.value = 2;
	c3.value;
	expect(cSpy).toHaveBeenCalledTimes(2);
	src2.value = 1;
	c3.value;
	expect(cSpy).toHaveBeenCalledTimes(3);
});

it('should trigger the second effect', () => {
	const fnSpy = vi.fn();
	const v = shallowRef(1);
	const c = computed(() => v.value);

	effect(() => {
		c.value;
	});
	effect(() => {
		c.value;
		fnSpy();
	});

	expect(fnSpy).toBeCalledTimes(1);
	v.value = 2;
	expect(fnSpy).toBeCalledTimes(2);
});

it('should chained recursive effects clear dirty after trigger', () => {
	const v = shallowRef(1);
	const c1 = computed(() => v.value);
	const c2 = computed(() => c1.value);

	c2.value;
	expect((c1 as unknown as Computed).dirtyLevel === DirtyLevels.Dirty).toBeFalsy();
	expect((c2 as unknown as Computed).dirtyLevel === DirtyLevels.Dirty).toBeFalsy();
});

it('should chained computeds dirtyLevel update with first computed effect', () => {
	const v = shallowRef(0);
	const c1 = computed(() => {
		if (v.value === 0) {
			v.value = 1;
		}
		return v.value;
	});
	const c2 = computed(() => c1.value);
	const c3 = computed(() => c2.value);

	c3.value;
	// expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
});

it('should work when chained(ref+computed)', () => {
	const v = shallowRef(0);
	const c1 = computed(() => {
		if (v.value === 0) {
			v.value = 1;
		}
		return 'foo';
	});
	const c2 = computed(() => v.value + c1.value);
	expect(c2.value).toBe('0foo');
	expect(c2.value).toBe('1foo');
	// expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
});

it('should trigger effect even computed already dirty', () => {
	const fnSpy = vi.fn();
	const v = shallowRef(0);
	const c1 = computed(() => {
		if (v.value === 0) {
			v.value = 1;
		}
		return 'foo';
	});
	const c2 = computed(() => v.value + c1.value);

	effect(() => {
		fnSpy(c2.value);
	});
	expect(fnSpy).toBeCalledTimes(1);
	expect(fnSpy.mock.calls).toMatchObject([['0foo']]);
	expect(v.value).toBe(1);
	v.value = 2;
	expect(fnSpy).toBeCalledTimes(2);
	expect(fnSpy.mock.calls).toMatchObject([['0foo'], ['2foo']]);
	expect(v.value).toBe(2);
	// expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
});

// #10185
it('should not override queried MaybeDirty result', () => {
	class Item {
		v = shallowRef(0);
	}
	const v1 = shallowRef();
	const v2 = shallowRef(false);
	const c1 = computed(() => {
		let c = v1.value;
		if (!v1.value) {
			c = new Item();
			v1.value = c;
		}
		return c.v.value;
	});
	const c2 = computed(() => {
		if (!v2.value) return 'no';
		return c1.value ? 'yes' : 'no';
	});
	const c3 = computed(() => c2.value);

	c3.value;
	v2.value = true;

	c3.value;
	v1.value.v.value = 999;

	expect(c3.value).toBe('yes');
	// expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
});

test('should not trigger if value did not change', () => {
	const src = shallowRef(0);
	const c = computed(() => src.value % 2);
	const spy = vi.fn();
	effect(() => {
		spy(c.value);
	});
	expect(spy).toHaveBeenCalledTimes(1);
	src.value = 2;

	// should not trigger
	expect(spy).toHaveBeenCalledTimes(1);

	src.value = 3;
	src.value = 5;
	// should trigger because latest value changes
	expect(spy).toHaveBeenCalledTimes(2);
});

test('chained computed trigger', () => {
	const effectSpy = vi.fn();
	const c1Spy = vi.fn();
	const c2Spy = vi.fn();

	const src = shallowRef(0);
	const c1 = computed(() => {
		c1Spy();
		return src.value % 2;
	});
	const c2 = computed(() => {
		c2Spy();
		return c1.value + 1;
	});

	effect(() => {
		effectSpy(c2.value);
	});

	expect(c1Spy).toHaveBeenCalledTimes(1);
	expect(c2Spy).toHaveBeenCalledTimes(1);
	expect(effectSpy).toHaveBeenCalledTimes(1);

	src.value = 1;
	expect(c1Spy).toHaveBeenCalledTimes(2);
	expect(c2Spy).toHaveBeenCalledTimes(2);
	expect(effectSpy).toHaveBeenCalledTimes(2);
});

test('chained computed avoid re-compute', () => {
	const effectSpy = vi.fn();
	const c1Spy = vi.fn();
	const c2Spy = vi.fn();

	const src = shallowRef(0);
	const c1 = computed(() => {
		c1Spy();
		return src.value % 2;
	});
	const c2 = computed(() => {
		c2Spy();
		return c1.value + 1;
	});

	effect(() => {
		effectSpy(c2.value);
	});

	expect(effectSpy).toHaveBeenCalledTimes(1);
	src.value = 2;
	src.value = 4;
	src.value = 6;
	expect(c1Spy).toHaveBeenCalledTimes(4);
	// c2 should not have to re-compute because c1 did not change.
	expect(c2Spy).toHaveBeenCalledTimes(1);
	// effect should not trigger because c2 did not change.
	expect(effectSpy).toHaveBeenCalledTimes(1);
});

test('chained computed value invalidation', () => {
	const effectSpy = vi.fn();
	const c1Spy = vi.fn();
	const c2Spy = vi.fn();

	const src = shallowRef(0);
	const c1 = computed(() => {
		c1Spy();
		return src.value % 2;
	});
	const c2 = computed(() => {
		c2Spy();
		return c1.value + 1;
	});

	effect(() => {
		effectSpy(c2.value);
	});

	expect(effectSpy).toHaveBeenCalledTimes(1);
	expect(effectSpy).toHaveBeenCalledWith(1);
	expect(c2.value).toBe(1);

	expect(c1Spy).toHaveBeenCalledTimes(1);
	expect(c2Spy).toHaveBeenCalledTimes(1);

	src.value = 1;
	// value should be available sync
	expect(c2.value).toBe(2);
	expect(c2Spy).toHaveBeenCalledTimes(2);
});

test('sync access of invalidated chained computed should not prevent final effect from running', () => {
	const effectSpy = vi.fn();
	const c1Spy = vi.fn();
	const c2Spy = vi.fn();

	const src = shallowRef(0);
	const c1 = computed(() => {
		c1Spy();
		return src.value % 2;
	});
	const c2 = computed(() => {
		c2Spy();
		return c1.value + 1;
	});

	effect(() => {
		effectSpy(c2.value);
	});
	expect(effectSpy).toHaveBeenCalledTimes(1);

	src.value = 1;
	// sync access c2
	c2.value;
	expect(effectSpy).toHaveBeenCalledTimes(2);
});

it('computed should force track in untracked zone', () => {
	const n = shallowRef(0);
	const spy1 = vi.fn();
	const spy2 = vi.fn();

	let c: { value: number; };
	effect(() => {
		spy1();
		pauseTracking();
		n.value;
		c = computed(() => n.value + 1);
		// access computed now to force refresh
		c.value;
		effect(() => spy2(c.value));
		n.value;
		resetTracking();
	});

	expect(spy1).toHaveBeenCalledTimes(1);
	expect(spy2).toHaveBeenCalledTimes(1);

	n.value++;
	// outer effect should not trigger
	expect(spy1).toHaveBeenCalledTimes(1);
	// inner effect should trigger
	expect(spy2).toHaveBeenCalledTimes(2);
});

// not recommended behavior, but needed for backwards compatibility
// used in VueUse asyncComputed
it('computed side effect should be able trigger', () => {
	const a = shallowRef(false);
	const b = shallowRef(false);
	const c = computed(() => {
		a.value = true;
		return b.value;
	});
	effect(() => {
		if (a.value) {
			b.value = true;
		}
	});
	expect(b.value).toBe(false);
	// accessing c triggers change
	c.value;
	expect(b.value).toBe(true);
	expect(c.value).toBe(true);
});

it('chained computed should work when accessed before having subs', () => {
	const n = shallowRef(0);
	const c = computed(() => n.value);
	const d = computed(() => c.value + 1);
	const spy = vi.fn();

	// access
	d.value;

	let dummy;
	effect(() => {
		spy();
		dummy = d.value;
	});
	expect(spy).toHaveBeenCalledTimes(1);
	expect(dummy).toBe(1);

	n.value++;
	expect(spy).toHaveBeenCalledTimes(2);
	expect(dummy).toBe(2);
});

it('should be recomputed without being affected by side effects', () => {
	const v = shallowRef(0);
	const c1 = computed(() => {
		v.value = 1;
		return 0;
	});
	const c2 = computed(() => {
		return v.value + ',' + c1.value;
	});

	expect(c2.value).toBe('0,0');
	v.value = 1;
	expect(c2.value).toBe('1,0');
	// expect(COMPUTED_SIDE_EFFECT_WARN).toHaveBeenWarned()
});
