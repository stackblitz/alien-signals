import { activeSub, activeTrackId, nextTrackId, setActiveSub } from './effect.js';
import { activeEffectScope, activeScopeTrackId } from './effectScope.js';
import { checkDirty, endTrack, IComputed, Link, link, shallowPropagate, startTrack, SubscriberFlags } from './system.js';
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
			if (this.update()) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		} else if (flags & SubscriberFlags.ToCheckDirty) {
			if (checkDirty(this.deps!)) {
				if (this.update()) {
					const subs = this.subs;
					if (subs !== undefined) {
						shallowPropagate(subs);
					}
				}
			} else {
				this.flags = flags & ~SubscriberFlags.ToCheckDirty;
			}
		}
		if (activeTrackId) {
			if (this.lastTrackedId !== activeTrackId) {
				this.lastTrackedId = activeTrackId;
				link(this, activeSub!);
			}
		} else if (activeScopeTrackId) {
			if (this.lastTrackedId !== activeScopeTrackId) {
				this.lastTrackedId = activeScopeTrackId;
				link(this, activeEffectScope!);
			}
		}
		return this.currentValue!;
	}

	update(): boolean {
		const prevSub = activeSub;
		const prevTrackId = activeTrackId;
		setActiveSub(this, nextTrackId());
		startTrack(this);
		const oldValue = this.currentValue;
		try {
			return (this.currentValue = this.getter(oldValue)) !== oldValue;
		} finally {
			setActiveSub(prevSub, prevTrackId);
			endTrack(this);
		}
	}
}
