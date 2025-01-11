import { endTrack, startTrack } from './internal.js';
import { Link, Subscriber, SubscriberFlags } from './system.js';

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

export class EffectScope implements Subscriber {
	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	flags: SubscriberFlags = SubscriberFlags.None;

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
