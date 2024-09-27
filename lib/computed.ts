import { Dependency, DirtyLevels, ISignal, Subscriber } from './system';

export class Computed<T = any> implements ISignal<T>, Dependency, Subscriber {
	private oldValue: T | undefined = undefined;

	// Dependency
	firstSub = null;
	lastSub = null;
	subVersion = -1;

	// Subscriber
	firstDep = null;
	lastDep = null;
	depsLength = 0;
	dirtyLevel = DirtyLevels.Dirty;
	version = -1;

	constructor(
		private getter: (oldValue?: T) => T
	) { }

	get(): T {
		Dependency.link(this);
		if (Subscriber.isDirty(this)) {
			const lastActiveSub = Subscriber.trackStart(this);
			if (!Object.is(
				this.oldValue,
				this.oldValue = this.getter(this.oldValue)
			)) {
				Dependency.broadcast(this);
			}
			Subscriber.trackEnd(this, lastActiveSub);
		}
		return this.oldValue!;
	}
}

export function computed<T>(getter: (oldValue?: T) => T) {
	return new Computed(getter);
}
