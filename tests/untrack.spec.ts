import { expect, test } from 'vitest';
import { computed, effect, effectScope, setCurrentSub, signal } from '../src';

test('should pause tracking in computed', () => {
	const src = signal(0);

	let computedTriggerTimes = 0;
	const c = computed(() => {
		computedTriggerTimes++;
		const currentSub = setCurrentSub(undefined);
		const value = src();
		setCurrentSub(currentSub);
		return value;
	});

	expect(c()).toBe(0);
	expect(computedTriggerTimes).toBe(1);

	src(1), src(2), src(3);
	expect(c()).toBe(0);
	expect(computedTriggerTimes).toBe(1);
});

test('should pause tracking in effect', () => {
	const src = signal(0);
	const is = signal(0);

	let effectTriggerTimes = 0;
	effect(() => {
		effectTriggerTimes++;
		if (is()) {
			const currentSub = setCurrentSub(undefined);
			src();
			setCurrentSub(currentSub);
		}
	});

	expect(effectTriggerTimes).toBe(1);

	is(1);
	expect(effectTriggerTimes).toBe(2);

	src(1), src(2), src(3);
	expect(effectTriggerTimes).toBe(2);

	is(2);
	expect(effectTriggerTimes).toBe(3);

	src(4), src(5), src(6);
	expect(effectTriggerTimes).toBe(3);

	is(0);
	expect(effectTriggerTimes).toBe(4);

	src(7), src(8), src(9);
	expect(effectTriggerTimes).toBe(4);
});

test('should pause tracking in effect scope', () => {
	const src = signal(0);

	let effectTriggerTimes = 0;
	effectScope(() => {
		effect(() => {
			effectTriggerTimes++;
			const currentSub = setCurrentSub(undefined);
			src();
			setCurrentSub(currentSub);
		});
	});

	expect(effectTriggerTimes).toBe(1);

	src(1), src(2), src(3);
	expect(effectTriggerTimes).toBe(1);
});