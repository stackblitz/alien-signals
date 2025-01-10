import { activeSub, setActiveSub } from './effect.js';
import { activeEffectScope } from './effectScope.js';
import { endTrack, IComputed, ILink, isDirty, link, shallowPropagate, startTrack, SubscriberFlags } from './system.js';
import type { ISignal } from './types.js';

export function computed<T>(getter: (cachedValue?: T) => T): Computed<T> {
	return new Computed<T>(getter);
}

export class Computed<T = any> implements IComputed, ISignal<T> {
	currentValue: T | undefined = undefined;

	// Dependency
	subs: ILink | undefined = undefined;
	subsTail: ILink | undefined = undefined;

	// Subscriber
	deps: ILink | undefined = undefined;
	depsTail: ILink | undefined = undefined;
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
