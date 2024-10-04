import { currentEffectScope } from './effectScope';
import { DirtyLevels, IEffect, Subscriber } from './system';

export class Effect implements IEffect, Subscriber {
	scope = currentEffectScope;
	nextNotify = undefined;
	prevEffect: Effect | undefined = undefined;
	nextEffect: Effect | undefined = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		private fn: () => void
	) {
		this.scope.add(this);
		this.run();
	}

	notify() {
		if (this.versionOrDirtyLevel === DirtyLevels.MaybeDirty) {
			Subscriber.resolveMaybeDirty(this);
		}
		if (this.versionOrDirtyLevel === DirtyLevels.Dirty) {
			this.run();
		}
	}

	run() {
		const lastActiveSub = Subscriber.startTrack(this);
		this.fn();
		Subscriber.endTrack(this, lastActiveSub);
	}

	stop() {
		Subscriber.preTrack(this);
		Subscriber.postTrack(this);
		this.scope.remove(this);
	}
}
