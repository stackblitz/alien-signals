import { Dependency, DirtyLevels, Subscriber } from './system';

export class Computed<T = any> implements Dependency, Subscriber {
	oldValue: T | undefined = undefined;

	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	dirtyLevel = DirtyLevels.Dirty;
	version = -1;

	constructor(
		public getter: (oldValue?: T) => T
	) { }

	update() {
		if (Subscriber.isDirty(this)) {
			const lastActiveSub = Subscriber.trackStart(this);
			if (!Object.is(
				this.oldValue,
				this.oldValue = this.getter(this.oldValue)
			)) {
				Subscriber.trackEnd(this, lastActiveSub);
				Dependency.broadcast(this);
			}
			else {
				Subscriber.trackEnd(this, lastActiveSub);
			}
		}
	}

	get(): T {
		Dependency.link(this);
		this.update();
		return this.oldValue!;
	}
}

export function computed<T>(getter: (oldValue?: T) => T) {
	return new Computed(getter);
}
