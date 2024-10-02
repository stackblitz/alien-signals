import { Dependency, DirtyLevels, Subscriber } from './system';

export class Computed<T = any> implements Dependency, Subscriber {
	cachedValue: T | undefined = undefined;

	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	prevUpdate = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		public getter: (oldValue?: T) => T
	) { }

	get(): T {
		Dependency.link(this);
		Subscriber.update(this);
		return this.cachedValue!;
	}

	run() {
		const lastActiveSub = Subscriber.startTrack(this);
		if (this.cachedValue !== (this.cachedValue = this.getter(this.cachedValue))) {
			Subscriber.endTrack(this, lastActiveSub);
			Dependency.propagate(this);
		}
		else {
			Subscriber.endTrack(this, lastActiveSub);
		}
	}
}

export function computed<T>(getter: (oldValue?: T) => T) {
	return new Computed(getter);
}
