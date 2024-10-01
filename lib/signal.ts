import { endBatch, startBatch, Dependency } from './system';

export class Signal<T = any> implements Dependency {
	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;

	constructor(
		public oldValue: T | undefined = undefined
	) { }

	get() {
		Dependency.link(this);
		return this.oldValue!;
	}

	set(value: T) {
		if (!Object.is(this.oldValue, this.oldValue = value)) {
			startBatch();
			Dependency.broadcast(this);
			endBatch();
		}
	}
}

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(oldValue: T): Signal<T>;
export function signal<T>(oldValue?: T): Signal<T | undefined> {
	return new Signal(oldValue);
}
