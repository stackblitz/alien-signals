import { activeSub, setActiveSub } from './effect.js';
import { activeEffectScope } from './effectScope.js';
import { endTrack, isDirty, link, shallowPropagate, startTrack } from './internal.js';
import { Dependency, Link, Subscriber, SubscriberFlags } from './system.js';
import type { ISignal } from './types.js';

export function computed<T>(getter: (cachedValue?: T) => T): Computed<T> {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements Dependency, Subscriber, ISignal<T> {
	currentValue: T | undefined = undefined;

	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	flags: SubscriberFlags = SubscriberFlags.Dirty;

	constructor(
		public getter: (cachedValue?: T) => T
	) { }

	get(): T {
		const flags = this.flags;
		if (
			flags & (SubscriberFlags.ToCheckDirty | SubscriberFlags.Dirty)
			&& isDirty(this, flags)
		) {
			if (this.update()) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		}
		if (activeSub !== undefined) {
			link(this, activeSub);
		} else if (activeEffectScope !== undefined) {
			link(this, activeEffectScope);
		}
		return this.currentValue!;
	}

	update(): boolean {
		const prevSub = activeSub;
		setActiveSub(this);
		startTrack(this);
		try {
			const oldValue = this.currentValue;
			const newValue = this.getter(oldValue);
			if (oldValue !== newValue) {
				this.currentValue = newValue;
				return true;
			}
			return false;
		} finally {
			setActiveSub(prevSub);
			endTrack(this);
		}
	}
}
