import { System, Dependency } from './system';

export class Signal<T = any> implements Dependency {
	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;

	constructor(
		public currentValue: T | undefined = undefined
	) { }

	get() {
		Dependency.link(this);
		return this.currentValue!;
	}

	set(value: T) {
		if (this.currentValue !== (this.currentValue = value)) {
			System.startBatch();
			Dependency.propagate(this);
			System.endBatch();
		}
	}
}

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(oldValue: T): Signal<T>;
export function signal<T>(oldValue?: T): Signal<T | undefined> {
	return new Signal(oldValue);
}
