import { endTrack, Link, startTrack, Subscriber, SubscriberFlags } from './system.js';

export let activeEffectScope: EffectScope | undefined = undefined;

export function effectScope(): EffectScope {
	return new EffectScope();
}

export class EffectScope implements Subscriber {
	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	flags: SubscriberFlags = SubscriberFlags.None;

	notify(): void {
		if (this.flags & SubscriberFlags.RunInnerEffects) {
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

	run<T>(fn: () => T): T {
		const prevSub = activeEffectScope;
		activeEffectScope = this;
		try {
			return fn();
		} finally {
			activeEffectScope = prevSub;
		}
	}

	stop(): void {
		startTrack(this);
		endTrack(this);
	}
}
