import { System, Dependency } from './system.js';

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
		const subVersion = System.activeSubVersion;
		if (subVersion >= 0 && this.subVersion !== subVersion) {
			this.subVersion = subVersion;
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
