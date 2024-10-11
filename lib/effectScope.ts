import { DirtyLevels, Subscriber } from './system';

export function effectScope() {
	return new EffectScope();
}

export class EffectScope implements Subscriber {
	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	notifyLostSubs() { }

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
