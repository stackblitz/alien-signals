import { ISignal } from './computed.js';
import { activeSub, activeTrackId } from './effect.js';
import { Dependency, drainQueuedEffects, link, Link, propagate } from './system.js';

export interface IWritableSignal<T = any> extends ISignal<T> {
	set(value: T): void;
}

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(oldValue: T): Signal<T>;
export function signal<T>(oldValue?: T): Signal<T | undefined> {
	return new Signal(oldValue);
}

export class Signal<T = any> implements Dependency {
	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;
	lastTrackedId = 0;

	constructor(
		public currentValue: T
	) { }

	get(): NonNullable<T> {
		if (activeTrackId > 0 && this.lastTrackedId !== activeTrackId) {
			this.lastTrackedId = activeTrackId;
			link(this, activeSub!);
		}
		return this.currentValue!;
	}

	set(value: T): void {
		if (this.currentValue !== (this.currentValue = value)) {
			const subs = this.subs;
			if (subs !== undefined) {
				propagate(subs);
				drainQueuedEffects();
			}
		}
	}
}
