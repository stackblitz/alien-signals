import { expect, test } from 'vitest';
import { asyncComputed, asyncEffect } from '../src';
import { signal } from './api';

test('should track dep after await', async () => {
	const src = signal(0);
	const c = asyncComputed(async function* () {
		await new Promise(r => setTimeout(r, 100));
		return (yield src, src).get();
	});
	expect(await c.get()).toBe(0);

	src.set(1);
	expect(await c.get()).toBe(1);
});

test('should trigger asyncEffect', async () => {
	let triggerTimes = 0;

	const src = signal(0);
	const c = asyncComputed(async function* () {
		await new Promise(r => setTimeout(r, 100));
		return (yield src, src).get();
	});
	asyncEffect(async function* () {
		triggerTimes++;
		(yield c, c).get();
	});
	expect(triggerTimes).toBe(1);

	await new Promise(r => setTimeout(r, 200));
	src.set(1);
	await new Promise(r => setTimeout(r, 200));
	expect(triggerTimes).toBe(2);
});
