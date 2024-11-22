import { activeSub, activeTrackId, nextTrackId, setActiveSub } from './effect.js';
import { checkDirty, endTrack, IComputed, Link, link, startTrack, SubscriberFlags } from './system.js';

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
	flags: SubscriberFlags = SubscriberFlags.Dirty;

	constructor(
		public getter: (cachedValue?: T) => T
	) { }

	get(): T {
		if ((this.flags & SubscriberFlags.Dirty) !== 0) {
			this.update();
		} else if ((this.flags & SubscriberFlags.ToCheckDirty) !== 0) {
			if (checkDirty(this.deps!)) {
				this.update();
			} else {
				this.flags &= ~SubscriberFlags.ToCheckDirty;
			}
		}
		if (activeTrackId > 0 && this.lastTrackedId !== activeTrackId) {
			this.lastTrackedId = activeTrackId;
			link(this, activeSub!).version = this.version;
		}
		return this.cachedValue!;
	}

	update(): boolean {
		const prevSub = activeSub;
		const prevTrackId = activeTrackId;
		setActiveSub(this, nextTrackId());
		startTrack(this);
		const oldValue = this.cachedValue;
		let newValue: T;
		try {
			newValue = this.getter(oldValue);
		} finally {
			setActiveSub(prevSub, prevTrackId);
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
