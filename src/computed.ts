import { Dependency, DirtyLevels, IComputed, Subscriber, System } from './system.js';

export function computed<T>(getter: (cachedValue?: T) => T) {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements IComputed {
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
		const subVersion = System.activeSubVersion;
		if (subVersion >= 0 && this.subVersion !== subVersion) {
			this.subVersion = subVersion;
			Dependency.linkSubscriber(this, System.activeSub!);
		}
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
		let newValue: T;
		try {
			newValue = this.getter(oldValue);
		} finally {
			Subscriber.endTrackDependencies(this, prevSub);
		}
		if (oldValue !== newValue) {
			this.cachedValue = newValue;
			const subs = this.subs;
			if (subs !== undefined) {
				Dependency.propagate(subs);
			}
		}
		return newValue;
	}
}
