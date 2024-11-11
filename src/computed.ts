import { Dependency, DirtyLevels, IComputed, Link, Subscriber, System } from './system.js';

export interface ISignal<T = any> {
	get(): T;
}

export function computed<T>(getter: (cachedValue?: T) => T): ISignal<T> {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements IComputed {
	cachedValue: T | undefined = undefined;

	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	trackId = 0;
	dirtyLevel = DirtyLevels.Dirty;
	canPropagate = false;

	constructor(
		public getter: (cachedValue?: T) => T
	) { }

	get(): T {
		let dirtyLevel = this.dirtyLevel;
		if (dirtyLevel === DirtyLevels.MaybeDirty) {
			Subscriber.resolveMaybeDirty(this);
			dirtyLevel = this.dirtyLevel;
		}
		if (dirtyLevel >= DirtyLevels.Dirty) {
			this.update();
		}
		const activeTrackId = System.activeTrackId;
		if (activeTrackId !== 0) {
			const subsTail = this.subsTail;
			if (subsTail === undefined || subsTail.trackId !== activeTrackId) {
				Dependency.link(this, System.activeSub!);
			}
		}
		return this.cachedValue!;
	}

	update() {
		const prevSub = Subscriber.startTrack(this);
		const oldValue = this.cachedValue;
		let newValue: T;
		try {
			newValue = this.getter(oldValue);
		} finally {
			Subscriber.endTrack(this, prevSub);
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
