import { drainQueuedEffects } from './system.js';

export let batchDepth = 0;

export function startBatch(): void {
	++batchDepth;
}

export function endBatch(): void {
	if (!--batchDepth) {
		drainQueuedEffects();
	}
}
