import { checkDirty, DirtyLevels, endTrack, IComputed, Link, link, startTrack, System } from './system.js';

export interface ISignal<T = any> {
	get(): T;
}

export function computed<T>(getter: (cachedValue?: T) => T): ISignal<T> {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements IComputed {
	cachedValue: T | undefined = undefined;
	version = 0;

	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;
	lastTrackedId = 0;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	tracking = false;
	dirtyLevel: DirtyLevels = DirtyLevels.Dirty;

	constructor(
		public getter: (cachedValue?: T) => T
	) { }

	get(): T {
		const dirtyLevel = this.dirtyLevel;
		if (dirtyLevel > DirtyLevels.None) {
			if (dirtyLevel === DirtyLevels.Dirty || checkDirty(this.deps!)) {
				this.update();
			} else {
				this.dirtyLevel = DirtyLevels.None;
			}
		}
		const activeTrackId = System.activeTrackId;
		if (activeTrackId > 0 && this.lastTrackedId !== activeTrackId) {
			this.lastTrackedId = activeTrackId;
			link(this, System.activeSub!).version = this.version;
		}
		return this.cachedValue!;
	}

	update(): boolean {
		const prevSub = System.activeSub;
		const prevTrackId = System.activeTrackId;
		System.activeSub = this;
		System.activeTrackId = ++System.lastTrackId;
		startTrack(this);
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
			this.version++;
			return true;
		}
		return false;
	}
}
