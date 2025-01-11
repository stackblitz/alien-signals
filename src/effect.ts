import { activeEffectScope } from './effectScope.js';
import { endTrack, isDirty, link, runInnerEffects, startTrack } from './internal.js';
import { Dependency, Link, Subscriber, SubscriberFlags } from './system.js';

export let activeSub: Subscriber | undefined;

export function untrack<T>(fn: () => T): T {
	const prevSub = activeSub;
	setActiveSub(undefined);
	try {
		return fn();
	} finally {
		setActiveSub(prevSub);
	}
}

export function setActiveSub(sub: Subscriber | undefined): void {
	activeSub = sub;
}

export function effect<T>(fn: () => T): Effect<T> {
	const e = new Effect(fn);
	e.run();
	return e;
}

export class Effect<T = any> implements Subscriber, Dependency {
	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	flags: SubscriberFlags = SubscriberFlags.None;

	constructor(
		public fn: () => T
	) {
		if (activeSub !== undefined) {
			link(this, activeSub);
		} else if (activeEffectScope !== undefined) {
			link(this, activeEffectScope);
		}
	}

	notify(): void {
		const flags = this.flags;
		if (
			flags & (SubscriberFlags.ToCheckDirty | SubscriberFlags.Dirty)
			&& isDirty(this, flags)
		) {
			this.run();
			return;
		}
		if (flags & SubscriberFlags.InnerEffectsPending) {
			this.flags = flags & ~SubscriberFlags.InnerEffectsPending;
			runInnerEffects(this.deps!);
		}
	}

	run(): T {
		const prevSub = activeSub;
		setActiveSub(this);
		startTrack(this);
		try {
			return this.fn();
		} finally {
			setActiveSub(prevSub);
			endTrack(this);
		}
	}

	stop(): void {
		startTrack(this);
		endTrack(this);
	}
}
