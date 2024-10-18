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
	versionOrDirtyLevel = DirtyLevels.Dirty;

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
		const dirtyLevel = this.versionOrDirtyLevel;
		if (dirtyLevel === DirtyLevels.SideEffectsOnly) {
			this.versionOrDirtyLevel = DirtyLevels.None;
			Subscriber.runInnerEffects(this);
		} else {
			if (dirtyLevel === DirtyLevels.MaybeDirty) {
				Subscriber.resolveMaybeDirty(this);
			}
			if (this.versionOrDirtyLevel === DirtyLevels.Dirty) {
				this.run();
			} else {
				Subscriber.runInnerEffects(this);
			}
		}
	}

	run() {
		const prevSub = Subscriber.startTrackDependencies(this);
		try {
			this.fn();
		} catch (e) {
			throw e;
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
		this.versionOrDirtyLevel = DirtyLevels.Dirty;
	}
}
