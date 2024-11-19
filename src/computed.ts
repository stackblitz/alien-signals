import { checkDirty, DirtyLevels, endTrack, IComputed, link, Link, propagate, startTrack, System } from './system.js';

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
	dirtyLevel: DirtyLevels = DirtyLevels.Dirty;
	canPropagate = false;

	constructor(
		public getter: (cachedValue?: T) => T
	) { }

	get(): T {
		const dirtyLevel = this.dirtyLevel;
		if (dirtyLevel > DirtyLevels.None) {
			if (dirtyLevel === DirtyLevels.Dirty || checkDirty(this.deps!)) {
				if (this.update()) {
					const subs = this.subs;
					if (subs !== undefined) {
						propagate(subs);
					}
				}
			} else {
				this.dirtyLevel = DirtyLevels.None;
			}
		}
		const activeTrackId = System.activeTrackId;
		if (activeTrackId > 0) {
			const subsTail = this.subsTail;
			if (subsTail === undefined || subsTail.trackId !== activeTrackId) {
				link(this, System.activeSub!, activeTrackId);
			}
		}
		return this.cachedValue!;
	}

	update(): boolean {
		const prevSub = System.activeSub;
		const prevTrackId = System.activeTrackId;
		System.activeSub = this;
		System.activeTrackId = startTrack(this);
		const oldValue = this.cachedValue;
		let newValue: T;
		try {
			newValue = this.getter(oldValue);
		} finally {
			System.activeSub = prevSub;
			System.activeTrackId = prevTrackId;
			endTrack(this);
		}
		if (oldValue !== newValue) {
			this.cachedValue = newValue;
			return true;
		}
		return false;
	}
}
