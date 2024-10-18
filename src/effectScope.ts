import { DirtyLevels, IEffectScope, Subscriber } from './system.js';

export function effectScope() {
	return new EffectScope();
}

export class EffectScope implements IEffectScope {
	nextNotify = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.None;

	notify() {
		if (this.versionOrDirtyLevel !== DirtyLevels.None) {
			this.versionOrDirtyLevel = DirtyLevels.None;
			Subscriber.runInnerEffects(this.deps);
		}
	}

	run<T>(fn: () => T) {
		const prevSub = Subscriber.startTrackEffects(this);
		try {
			return fn();
		} catch (e) {
			throw e;
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
		this.versionOrDirtyLevel = DirtyLevels.None;
	}
}
