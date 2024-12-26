import { activeSub, activeTrackId } from './effect.js';
import { Dependency, link, Link, propagate } from './system.js';
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
	lastTrackedId = 0;

	constructor(
		public currentValue: T
	) { }

	get(): NonNullable<T> {
		if (activeTrackId && this.lastTrackedId !== activeTrackId) {
			this.lastTrackedId = activeTrackId;
			link(this, activeSub!);
		}
		return this.currentValue!;
	}

	set(value: T): void {
		if (this.currentValue !== value) {
			this.currentValue = value;
			const subs = this.subs;
			if (subs !== undefined) {
				propagate(subs);
			}
		}
	}
}
