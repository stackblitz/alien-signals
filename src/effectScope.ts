import { DirtyLevels, Link, Subscriber, System } from './system.js';

export let activeEffectScope: EffectScope | undefined = undefined;

export function effectScope(): EffectScope {
	return new EffectScope();
}

export class EffectScope implements Subscriber {
	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	trackId: number = -(++System.lastTrackId);
	dirtyLevel: DirtyLevels = DirtyLevels.None;
	canPropagate = false;

	notify(): void {
		if (this.dirtyLevel !== DirtyLevels.None) {
			this.dirtyLevel = DirtyLevels.None;
			Subscriber.runInnerEffects(this.deps);
		}
	}

	run<T>(fn: () => T): T {
		const prevSub = activeEffectScope;
		activeEffectScope = this;
		this.trackId = Math.abs(this.trackId);
		try {
			return fn();
		} finally {
			activeEffectScope = prevSub;
			this.trackId = -Math.abs(this.trackId);
		}
	}

	stop(): void {
		if (this.deps !== undefined) {
			Subscriber.clearTrack(this.deps);
			this.deps = undefined;
			this.depsTail = undefined;
		}
		this.dirtyLevel = DirtyLevels.None;
	}
}
