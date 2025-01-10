import { nextTrackId } from './effect.js';
import { endTrack, runInnerEffects, Link, startTrack, Subscriber, SubscriberFlags } from './system.js';

export let activeEffectScope: EffectScope | undefined = undefined;
export let activeScopeTrackId = 0;

export function untrackScope<T>(fn: () => T): T {
	const prevSub = activeEffectScope;
	const prevTrackId = activeScopeTrackId;
	setActiveScope(undefined, 0);
	try {
		return fn();
	} finally {
		setActiveScope(prevSub, prevTrackId);
	}
}

export function setActiveScope(sub: EffectScope | undefined, trackId: number): void {
	activeEffectScope = sub;
	activeScopeTrackId = trackId;
}

export function effectScope(): EffectScope {
	return new EffectScope();
}

export class EffectScope implements Subscriber {
	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	flags: SubscriberFlags = SubscriberFlags.None;

	trackId: number = nextTrackId();

	notify(): void {
		const flags = this.flags;
		if (flags & SubscriberFlags.InnerEffectsPending) {
			this.flags = flags & ~SubscriberFlags.InnerEffectsPending;
			runInnerEffects(this.deps!);
		}
	}

	run<T>(fn: () => T): T {
		const prevSub = activeEffectScope;
		const prevTrackId = activeScopeTrackId;
		setActiveScope(this, this.trackId);
		try {
			return fn();
		} finally {
			setActiveScope(prevSub, prevTrackId);
		}
	}

	stop(): void {
		startTrack(this);
		endTrack(this);
	}
}
