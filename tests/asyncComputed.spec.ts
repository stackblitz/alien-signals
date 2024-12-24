import { expect, test } from 'vitest';
import { unstable } from '../src';
import { signal } from './api';

const { asyncComputed, asyncEffect } = unstable;

test('should track dep after await', async () => {
	const src = signal(0);
	const c = asyncComputed(async function* () {
		await sleep(100);
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
		await sleep(100);
		return (yield src, src).get();
	});
	asyncEffect(async function* () {
		triggerTimes++;
		(yield c, c).get();
	});
	expect(triggerTimes).toBe(1);

	await sleep(200);
	src.set(1);
	await sleep(200);
	expect(triggerTimes).toBe(2);
});

test.skip('should stop calculating when dep updated', async () => {
	let calcTimes = 0;

	const a = signal('a0');
	const b = signal('b0');
	const c = asyncComputed(async function* () {
		calcTimes++;
		const v1 = (yield a, a).get();
		await sleep(200);
		const v2 = (yield b, b).get();
		return v1 + '-' + v2;
	});

	expect(await c.get()).toBe('a0-b0');
	expect(calcTimes).toBe(1);

	a.set('a1');
	const promise = c.get();
	await sleep(100);
	expect(calcTimes).toBe(2);
	a.set('a2');

	expect(await promise).toBe('a2-b0');
	expect(calcTimes).toBe(3);
});

function sleep(ms: number) {
	return new Promise(r => setTimeout(r, ms));
}
