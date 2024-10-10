import { DirtyLevels, IEffect, Subscriber } from './system';

export function effectScope() {
	return new EffectScope();
}

export class EffectScope implements IEffect, Subscriber {
	nextNotify = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.NotDirty;
	isScope = true;

	notify() {
		Subscriber.resolveMaybeDirty(this);
		this.versionOrDirtyLevel = DirtyLevels.NotDirty;
	}

	run<T>(fn: () => T) {
		const prevActiveSub = Subscriber.startTrack(this);
		const res = fn();
		Subscriber.endTrack(this, prevActiveSub);
		return res;
	}

	stop() {
		Subscriber.clearTrack(this);
	}
}
