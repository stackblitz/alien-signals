import { DirtyLevels, Subscriber } from './system';

export function effectScope() {
	return new EffectScope();
}

export class EffectScope implements Subscriber {
	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.NotDirty;

	run<T>(fn: () => T) {
		const prevActiveSub = Subscriber.startScopeTrack(this);
		const res = fn();
		Subscriber.endScopeTrack(this, prevActiveSub);
		return res;
	}

	stop() {
		Subscriber.clearTrack(this);
	}
}
