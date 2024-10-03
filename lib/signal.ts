import { System, Dependency } from './system';

export class Signal<T = unknown> implements Dependency {
	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;

	constructor(
		public currentValue: T
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
