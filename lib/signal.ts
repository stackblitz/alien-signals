import { batchEnd, batchStart, Dependency } from './system';

export class Signal<T = any> implements Dependency {
	// Dependency
	computed = this;
	firstSub = null;
	lastSub = null;
	subVersion = -1;

	constructor(
		private oldValue: T | undefined = undefined
	) { }

	get() {
		Dependency.link(this);
		return this.oldValue!;
	}

	set(value: T) {
		if (!Object.is(this.oldValue, this.oldValue = value)) {
			batchStart();
			Dependency.broadcast(this);
			batchEnd();
		}
	}
}

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(oldValue: T): Signal<T>;
export function signal<T>(oldValue?: T): Signal<T | undefined> {
	return new Signal(oldValue);
}
