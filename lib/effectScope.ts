import { DirtyLevels, IEffect, Link, Subscriber } from './system.js';

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
		const prevActiveSub = Subscriber.startTrackEffects(this);
		const res = fn();
		Subscriber.endTrackEffects(this, prevActiveSub);
		return res;
	}

	stop() {
		if (this.deps !== undefined) {
			Link.releaseDeps(this.deps);
			Link.release(this.deps);
			this.deps = undefined;
		}
		this.versionOrDirtyLevel = DirtyLevels.None;
	}
}
