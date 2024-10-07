import { System, Dependency } from './system';

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(oldValue: T): Signal<T>;
export function signal<T>(oldValue?: T): Signal<T | undefined> {
	return new Signal(oldValue);
}

export class Signal<T = any> implements Dependency {
	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;

	constructor(
		public currentValue: T
	) { }

	get() {
		Dependency.linkSubscriber(this);
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
