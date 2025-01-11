import { batchDepth } from './batch.js';
import { activeSub } from './effect.js';
import { drainQueuedEffects, link, propagate } from './internal.js';
import { Dependency, Link } from './system.js';
import type { IWritableSignal } from './types.js';

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(oldValue: T): Signal<T>;
export function signal<T>(oldValue?: T): Signal<T | undefined> {
	return new Signal(oldValue);
}

export class Signal<T = any> implements Dependency, IWritableSignal<T> {
	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;

	constructor(
		public currentValue: T
	) { }

	get(): T {
		if (activeSub !== undefined) {
			link(this, activeSub);
		}
		return this.currentValue;
	}

	set(value: T): void {
		if (this.currentValue !== value) {
			this.currentValue = value;
			const subs = this.subs;
			if (subs !== undefined) {
				propagate(subs);
				if (!batchDepth) {
					drainQueuedEffects();
				}
			}
		}
	}
}
