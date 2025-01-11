import { getDefaultSystem } from '../src';
import { expect, test } from 'vitest';

const { signal, pauseTracking, resumeTracking, computed } = getDefaultSystem();

test('should parse tracking', () => {
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
