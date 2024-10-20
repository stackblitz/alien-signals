import { Dependency, DirtyLevels, IComputed, Subscriber, System } from './system.js';

export interface ISignal<T = any> {
	get(): T;
}

export function computed<T>(getter: (cachedValue?: T) => T): ISignal<T> {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements IComputed {
	cachedValue: T | undefined = undefined;

	// Dependency
	subs = undefined;
	subsTail = undefined;
	linkedTrackId = -1;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	trackId = 0;
	dirtyLevel = DirtyLevels.Dirty;
	canPropagate = false;

	constructor(
		public getter: (cachedValue?: T) => T
	) { }

	get(): T {
		const dirtyLevel = this.dirtyLevel;
		if (dirtyLevel === DirtyLevels.MaybeDirty) {
			Subscriber.resolveMaybeDirty(this);
			if (this.dirtyLevel === DirtyLevels.Dirty) {
				this.update();
			}
		} else if (dirtyLevel === DirtyLevels.Dirty) {
			this.update();
		}
		const subVersion = System.activeSubVersion;
		if (subVersion >= 0 && this.linkedTrackId !== subVersion) {
			this.linkedTrackId = subVersion;
			Dependency.linkSubscriber(this, System.activeSub!);
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
	}
}
