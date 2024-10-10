import { Dependency, DirtyLevels, Link, Subscriber } from './system';

export function computed<T>(getter: (cachedValue?: T) => T) {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements Dependency, Subscriber {
	cachedValue: T | undefined = undefined;

	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;
	depVersion = 0;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		public getter: (cachedValue?: T) => T
	) { }

	notifyLostSubs(): void {
		if (this.versionOrDirtyLevel === DirtyLevels.Dirty) {
			Subscriber.clearTrack(this);
		} else {
			let link = this.deps;
			while (link !== undefined) {
				Link.unlinkSub(link);
				link = link.nextDep;
			}
			this.versionOrDirtyLevel = DirtyLevels.MaybeDirty;
		}
	}

	get(): T {
		Dependency.link(this, true);
		const dirtyLevel = this.versionOrDirtyLevel;
		if (dirtyLevel === DirtyLevels.MaybeDirty) {
			if (this.deps?.sub !== undefined) {
				Subscriber.resolveMaybeDirty(this);
			} else {
				Subscriber.relinkDeps(this);
			}
			if (this.versionOrDirtyLevel === DirtyLevels.Dirty) {
				return this.update();
			}
		} else if (dirtyLevel === DirtyLevels.Dirty) {
			return this.update();
		}
		return this.cachedValue!;
	}

	update() {
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
