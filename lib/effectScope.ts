import { DirtyLevels, IEffect, Subscriber } from './system';

export function effectScope() {
	return new EffectScope();
}

export class EffectScope implements IEffect, Subscriber {
	nextNotify = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.None;

	notify() {
		if (this.versionOrDirtyLevel !== DirtyLevels.None) {
			this.versionOrDirtyLevel = DirtyLevels.None;
			Subscriber.runInnerEffects(this);
		}
	}

	run<T>(fn: () => T) {
		const prevActiveSub = Subscriber.startTrack(this, true);
		const res = fn();
		Subscriber.endTrack(this, prevActiveSub);
		return res;
	}

	stop() {
		Subscriber.clearTrack(this);
	}
}
