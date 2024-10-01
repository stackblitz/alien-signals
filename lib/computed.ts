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
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		public getter: (oldValue?: T) => T
	) { }

	update() {
		if (Subscriber.isDirty(this)) {
			const lastActiveSub = Subscriber.startTrack(this);
			if (!Object.is(
				this.oldValue,
				this.oldValue = this.getter(this.oldValue)
			)) {
				Subscriber.endTrack(this, lastActiveSub);
				Dependency.propagate(this);
			}
			else {
				Subscriber.endTrack(this, lastActiveSub);
			}
		}
	}

	get(): T {
		Dependency.link(this);
		if (Subscriber.isDirty(this)) {
			const lastActiveSub = Subscriber.startTrack(this);
			if (!Object.is(
				this.oldValue,
				this.oldValue = this.getter(this.oldValue)
			)) {
				Subscriber.endTrack(this, lastActiveSub);
				Dependency.propagate(this);
			}
			else {
				Subscriber.endTrack(this, lastActiveSub);
			}
		}
		return this.oldValue!;
	}
}

export function computed<T>(getter: (oldValue?: T) => T) {
	return new Computed(getter);
}
