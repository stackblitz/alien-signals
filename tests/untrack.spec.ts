import { expect, test } from 'vitest';
import { computed, pauseTracking, resumeTracking, signal } from '../src';

test('should pause tracking', () => {
	const src = signal(0);
	const c = computed(() => {
		pauseTracking();
		const value = src();
		resumeTracking();
		return value;
	});
	expect(c()).toBe(0);

	src(1);
	expect(c()).toBe(0);
});
