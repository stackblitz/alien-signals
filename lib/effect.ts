import { currentEffectScope } from './effectScope';
import { DirtyLevels, IEffect, Subscriber } from './system';

export function effect(fn: () => void) {
	const e = new Effect(fn);
	e.run();
	return e;
}

export class Effect implements IEffect, Subscriber {
	scope = currentEffectScope;
	nextNotify = undefined;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		private fn: () => void
	) {
		currentEffectScope?.subs.push(this);
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
		if (this.scope !== undefined) {
			this.scope.run(this.fn);
		}
		else {
			this.fn();
		}
		Subscriber.endTrack(this, lastActiveSub);
	}
}
