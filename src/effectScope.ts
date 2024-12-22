import { nextTrackId } from './effect.js';
import { endTrack, Link, startTrack, Subscriber, SubscriberFlags } from './system.js';

export let activeEffectScope: EffectScope | undefined = undefined;
export let activeScopeTrackId = 0;

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
		if (flags & SubscriberFlags.RunInnerEffects) {
			this.flags = flags & ~SubscriberFlags.RunInnerEffects;
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

	run<T>(fn: () => T): T {
		const prevSub = activeEffectScope;
		const prevTrackId = activeScopeTrackId;
		activeEffectScope = this;
		activeScopeTrackId = this.trackId;
		try {
			return fn();
		} finally {
			activeEffectScope = prevSub;
			activeScopeTrackId = prevTrackId;
		}
	}

	stop(): void {
		startTrack(this);
		endTrack(this);
	}
}
