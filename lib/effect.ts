import { currentEffectScope } from './effectScope';
import { DirtyLevels, IEffect, Subscriber } from './system';

export class Effect implements IEffect, Subscriber {
	nextNotify = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		private fn: () => void
	) {
		currentEffectScope?.subs.push(this);
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
}
