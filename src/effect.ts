import { Dependency, DirtyLevels, IEffect, Subscriber, System } from './system.js';

export function effect(fn: () => void) {
	const e = new Effect(fn);
	e.run();
	return e;
}

export class Effect implements IEffect {
	nextNotify = undefined;

	// Dependency
	subs = undefined;
	subsTail = undefined;
	linkedTrackId = -1;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	trackId = 0;
	dirtyLevel = DirtyLevels.Dirty;
	canPropagate = false;

	constructor(
		protected fn: () => void
	) {
		const subVersion = System.activeTrackId;
		if (subVersion > 0 && this.linkedTrackId !== subVersion) {
			this.linkedTrackId = subVersion;
			Dependency.linkSubscriber(this, System.activeSub!);
			return;
		}
		const activeTrackId = System.activeEffectScopeTrackId;
		if (activeTrackId > 0 && this.linkedTrackId !== activeTrackId) {
			this.linkedTrackId = activeTrackId;
			Dependency.linkSubscriber(this, System.activeEffectScope!);
		}
	}

	notify() {
		const dirtyLevel = this.dirtyLevel;
		if (dirtyLevel === DirtyLevels.SideEffectsOnly) {
			this.dirtyLevel = DirtyLevels.None;
			Subscriber.runInnerEffects(this.deps);
		} else {
			if (dirtyLevel === DirtyLevels.MaybeDirty) {
				Subscriber.resolveMaybeDirty(this);
			}
			if (this.dirtyLevel === DirtyLevels.Dirty) {
				this.run();
			} else {
				Subscriber.runInnerEffects(this.deps);
			}
		}
	}

	run() {
		const prevSub = Subscriber.startTrackDependencies(this);
		try {
			this.fn();
		} finally {
			Subscriber.endTrackDependencies(this, prevSub);
		}
	}

	stop() {
		if (this.deps !== undefined) {
			Subscriber.clearTrack(this.deps);
			this.deps = undefined;
			this.depsTail = undefined;
		}
		this.dirtyLevel = DirtyLevels.Dirty;
	}
}
