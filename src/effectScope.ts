import { endTrack, ILink, ISubscriber, runInnerEffects, startTrack, SubscriberFlags } from './system.js';

export let activeEffectScope: EffectScope | undefined = undefined;

export function untrackScope<T>(fn: () => T): T {
	const prevSub = activeEffectScope;
	setActiveScope(undefined);
	try {
		return fn();
	} finally {
		setActiveScope(prevSub);
	}
}

export function setActiveScope(sub: EffectScope | undefined): void {
	activeEffectScope = sub;
}

export function effectScope(): EffectScope {
	return new EffectScope();
}

export class EffectScope implements ISubscriber {
	// Subscriber
	deps: ILink | undefined = undefined;
	depsTail: ILink | undefined = undefined;
	flags: SubscriberFlags = SubscriberFlags.None;

	notify(): void {
		const flags = this.flags;
		if (flags & SubscriberFlags.InnerEffectsPending) {
			this.flags = flags & ~SubscriberFlags.InnerEffectsPending;
			runInnerEffects(this.deps!);
		}
	}

	run<T>(fn: () => T): T {
		const prevSub = activeEffectScope;
		setActiveScope(this);
		try {
			return fn();
		} finally {
			setActiveScope(prevSub);
		}
	}

	stop(): void {
		startTrack(this);
		endTrack(this);
	}
}
