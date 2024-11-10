import { DirtyLevels, IEffect, Link, Subscriber } from './system.js';

export function effectScope() {
	return new EffectScope();
}

export class EffectScope implements IEffect {
	nextNotify: IEffect | undefined = undefined;

	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	trackId = 0;
	dirtyLevel = DirtyLevels.None;
	canPropagate = false;

	notify() {
		if (this.dirtyLevel !== DirtyLevels.None) {
			this.dirtyLevel = DirtyLevels.None;
			Subscriber.runInnerEffects(this.deps);
		}
	}

	run<T>(fn: () => T) {
		const prevSub = Subscriber.startTrackEffects(this);
		try {
			return fn();
		} finally {
			Subscriber.endTrackEffects(this, prevSub);
		}
	}

	stop() {
		if (this.deps !== undefined) {
			Subscriber.clearTrack(this.deps);
			this.deps = undefined;
			this.depsTail = undefined;
		}
		this.dirtyLevel = DirtyLevels.None;
	}
}
