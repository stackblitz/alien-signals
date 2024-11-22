import { activeEffectScope } from './effectScope.js';
import { checkDirty, clearTrack, Dependency, endTrack, IEffect, link, Link, startTrack, Subscriber, SubscriberFlags } from './system.js';

export let activeSub: Subscriber | undefined;
export let activeTrackId = 0;
export let lastTrackId = 0;

export function setActiveSub(sub: Subscriber | undefined, trackId: number): void {
	activeSub = sub;
	activeTrackId = trackId;
}

export function nextTrackId(): number {
	return ++lastTrackId;
}

export function effect(fn: () => void): Effect<void> {
	const e = new Effect(fn);
	e.run();
	return e;
}

export class Effect<T = any> implements IEffect, Dependency {
	nextNotify: IEffect | undefined = undefined;

	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;
	lastTrackedId = 0;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	flags: SubscriberFlags = SubscriberFlags.Dirty;

	constructor(
		public fn: () => T
	) {
		if (activeTrackId > 0) {
			link(this, activeSub!);
		} else if (activeEffectScope !== undefined) {
			link(this, activeEffectScope);
		}
	}

	notify(): void {
		if ((this.flags & SubscriberFlags.Dirty) !== 0) {
			this.run();
			return;
		}
		if ((this.flags & SubscriberFlags.ToCheckDirty) !== 0) {
			if (checkDirty(this.deps!)) {
				this.run();
				return;
			} else {
				this.flags &= ~SubscriberFlags.ToCheckDirty;
			}
		}
		if ((this.flags & SubscriberFlags.RunInnerEffects) !== 0) {
			this.flags &= ~SubscriberFlags.RunInnerEffects;
			let link = this.deps!;
			do {
				const dep = link.dep;
				if ('notify' in dep) {
					dep.notify();
				}
				link = link.nextDep!;
			} while (link !== undefined);
		}
	}

	run(): T {
		const prevSub = activeSub;
		const prevTrackId = activeTrackId;
		setActiveSub(this, nextTrackId());
		startTrack(this);
		try {
			return this.fn();
		} finally {
			setActiveSub(prevSub, prevTrackId);
			endTrack(this);
		}
	}

	stop(): void {
		if (this.deps !== undefined) {
			clearTrack(this.deps);
			this.deps = undefined;
			this.depsTail = undefined;
		}
		this.flags = SubscriberFlags.None;
	}
}
