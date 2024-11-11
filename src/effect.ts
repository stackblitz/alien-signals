import { activeEffectScope } from './effectScope.js';
import { Dependency, DirtyLevels, IEffect, Link, Subscriber, System } from './system.js';

export function effect(fn: () => void) {
	const e = new Effect(fn);
	e.run();
	return e;
}

export class Effect<T = any> implements IEffect {
	nextNotify: IEffect | undefined = undefined;

	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	trackId = 0;
	dirtyLevel = DirtyLevels.Dirty;
	canPropagate = false;

	constructor(
		public fn: () => T
	) {
		const activeTrackId = System.activeTrackId;
		if (activeTrackId !== 0) {
			Dependency.link(this, System.activeSub!);
			return;
		}
		if (activeEffectScope !== undefined) {
			const subsTail = this.subsTail;
			if (subsTail === undefined || subsTail.trackId !== activeEffectScope.trackId) {
				Dependency.link(this, activeEffectScope);
			}
		}
	}

	notify() {
		let dirtyLevel = this.dirtyLevel;
		if (dirtyLevel > DirtyLevels.None) {
			if (dirtyLevel === DirtyLevels.MaybeDirty) {
				Subscriber.resolveMaybeDirty(this);
				dirtyLevel = this.dirtyLevel;
			}
			if (dirtyLevel === DirtyLevels.Dirty) {
				this.run();
			} else {
				this.dirtyLevel = DirtyLevels.None;
				Subscriber.runInnerEffects(this.deps);
			}
		}
	}

	run() {
		const prevSub = Subscriber.startTrack(this);
		try {
			return this.fn();
		} finally {
			Subscriber.endTrack(this, prevSub);
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
