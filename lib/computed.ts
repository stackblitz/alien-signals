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
		const versionOrDirtyLevel = this.versionOrDirtyLevel;
		if (versionOrDirtyLevel === DirtyLevels.MaybeDirty) {
			Subscriber.confirmDirtyLevel(this);
			if (this.versionOrDirtyLevel === DirtyLevels.Dirty) {
				return this.run();
			}
		}
		else if (versionOrDirtyLevel === DirtyLevels.Dirty) {
			return this.run();
		}
		return this.cachedValue!;
	}

	run() {
		const lastActiveSub = Subscriber.startTrack(this);
		const oldValue = this.cachedValue;
		const newValue = this.getter(oldValue);
		Subscriber.endTrack(this, lastActiveSub);
		if (oldValue !== newValue) {
			this.cachedValue = newValue;
			Dependency.propagate(this);
		}
		return newValue;
	}
}

export function computed<T>(getter: (oldValue?: T) => T) {
	return new Computed(getter);
}
