import { Dependency, DirtyLevels, Subscriber } from './system.js';

export function computed<T>(getter: (cachedValue?: T) => T) {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements Dependency, Subscriber {
	cachedValue: T | undefined = undefined;

	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		public getter: (cachedValue?: T) => T
	) { }

	get(): T {
		Dependency.linkDependencySubscriber(this);
		const dirtyLevel = this.versionOrDirtyLevel;
		if (dirtyLevel === DirtyLevels.MaybeDirty) {
			Subscriber.resolveMaybeDirty(this);
			if (this.versionOrDirtyLevel === DirtyLevels.Dirty) {
				return this.update();
			}
		} else if (dirtyLevel >= DirtyLevels.Dirty) {
			return this.update();
		}
		return this.cachedValue!;
	}

	update() {
		const prevSub = Subscriber.startTrackDependencies(this);
		const oldValue = this.cachedValue;
		const newValue = this.getter(oldValue);
		Subscriber.endTrackDependencies(this, prevSub);
		if (oldValue !== newValue) {
			this.cachedValue = newValue;
			Dependency.propagate(this);
		}
		return newValue;
	}
}
