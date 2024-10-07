import { Dependency, DirtyLevels, Subscriber } from './system';

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
		Dependency.linkSubscriber(this);
		const dirtyLevel = this.versionOrDirtyLevel;
		if (dirtyLevel === DirtyLevels.MaybeDirty) {
			Subscriber.resolveMaybeDirty(this);
			if (this.versionOrDirtyLevel === DirtyLevels.Dirty) {
				return this.run();
			}
		} else if (dirtyLevel === DirtyLevels.Dirty) {
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
