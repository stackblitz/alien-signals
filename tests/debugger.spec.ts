import { expect, test } from 'vitest';
import { signal, computed, effect } from '../src';
test('debugger', () => {
	const count1 = signal(1);
	const count2 = signal(100);
	effect(function fn1() {
		console.log(`effect1-> count1 is: ${count1()}`);
		console.log(`effect1-> count2 is: ${count2()}`);
	});
	effect(function fn2() {
		console.log(`effect2-> count1 is: ${count1()}`);
		console.log(`effect2-> count2 is: ${count2()}`);
	});
	count1(2);
	count1(200);
});