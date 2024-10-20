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
	subVersion = -1;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	version = 0;
	dirtyLevel = DirtyLevels.Dirty;
	shouldPropagate = false;

	constructor(
		protected fn: () => void
	) {
		const subVersion = System.activeSubVersion;
		if (subVersion >= 0 && this.subVersion !== subVersion) {
			this.subVersion = subVersion;
			Dependency.linkSubscriber(this, System.activeSub!);
			return;
		}
		const scopeVersion = System.activeEffectScopeVersion;
		if (scopeVersion >= 0 && this.subVersion !== scopeVersion) {
			this.subVersion = scopeVersion;
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
