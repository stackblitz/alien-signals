import { activeEffectScope, activeScopeTrackId } from './effectScope.js';
import { activeSub, activeTrackId, nextTrackId, setActiveSub } from './effect.js';
import { checkDirty, endTrack, IComputed, Link, link, startTrack, SubscriberFlags } from './system.js';
import type { ISignal } from './types.js';

export function computed<T>(getter: (cachedValue?: T) => T): Computed<T> {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements IComputed, ISignal<T> {
	currentValue: T | undefined = undefined;

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
		const flags = this.flags;
		if (flags & SubscriberFlags.Dirty) {
			this.update();
		} else if (flags & SubscriberFlags.ToCheckDirty) {
			if (checkDirty(this.deps!)) {
				this.update();
			} else {
				this.flags &= ~SubscriberFlags.ToCheckDirty;
			}
		}
		const currentValue = this.currentValue!;
		if (activeTrackId) {
			if (this.lastTrackedId !== activeTrackId) {
				this.lastTrackedId = activeTrackId;
				link(this, activeSub!).value = currentValue;
			}
		} else if (activeScopeTrackId) {
			if (this.lastTrackedId !== activeScopeTrackId) {
				this.lastTrackedId = activeScopeTrackId;
				link(this, activeEffectScope!).value = currentValue;
			}
		}
		return currentValue;
	}

	update(): T {
		const prevSub = activeSub;
		const prevTrackId = activeTrackId;
		setActiveSub(this, nextTrackId());
		startTrack(this);
		try {
			return this.currentValue = this.getter(this.currentValue);
		} finally {
			setActiveSub(prevSub, prevTrackId);
			endTrack(this);
		}
	}
}
