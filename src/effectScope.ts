import { DirtyLevels, IEffectScope, Subscriber } from './system.js';

export function effectScope() {
	return new EffectScope();
}

export class EffectScope implements IEffectScope {
	nextNotify = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	version = 0;
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
