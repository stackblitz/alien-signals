import { ISignal } from './computed.js';
import { System, Dependency } from './system.js';

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
	subs = undefined;
	subsTail = undefined;
	linkedTrackId = -1;

	constructor(
		public currentValue: T
	) { }

	get() {
		const activeTrackId = System.activeTrackId;
		if (activeTrackId > 0 && this.linkedTrackId !== activeTrackId) {
			this.linkedTrackId = activeTrackId;
			Dependency.linkSubscriber(this, System.activeSub!);
		}
		return this.currentValue!;
	}

	set(value: T) {
		if (this.currentValue !== (this.currentValue = value)) {
			const subs = this.subs;
			if (subs !== undefined) {
				System.startBatch();
				Dependency.propagate(subs);
				System.endBatch();
			}
		}
	}
}
