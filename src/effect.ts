import { activeEffectScope } from './effectScope.js';
import { checkDirty, clearTrack, Dependency, DirtyLevels, endTrack, IEffect, link, Link, startTrack, System } from './system.js';

export function effect(fn: () => void): Effect<void> {
	const e = new Effect(fn);
	e.run();
	return e;
}

export class Effect<T = any> implements IEffect, Dependency {
	nextNotify: IEffect | undefined = undefined;

	// Dependency
	subs: Link | undefined = undefined;
	subsTail: Link | undefined = undefined;

	// Subscriber
	deps: Link | undefined = undefined;
	depsTail: Link | undefined = undefined;
	trackId = 0;
	dirtyLevel: DirtyLevels = DirtyLevels.Dirty;
	canPropagate = false;

	constructor(
		public fn: () => T
	) {
		const activeTrackId = System.activeTrackId;
		if (activeTrackId > 0) {
			link(this, System.activeSub!);
			return;
		}
		if (activeEffectScope !== undefined) {
			const subsTail = this.subsTail;
			if (subsTail === undefined || subsTail.trackId !== activeEffectScope.trackId) {
				link(this, activeEffectScope);
			}
		}
	}

	notify(): void {
		let dirtyLevel = this.dirtyLevel;
		if (dirtyLevel > DirtyLevels.None) {
			if (dirtyLevel === DirtyLevels.MaybeDirty) {
				dirtyLevel = checkDirty(this.deps!)
					? DirtyLevels.Dirty
					: DirtyLevels.SideEffectsOnly;
			}
			if (dirtyLevel === DirtyLevels.Dirty) {
				this.run();
			} else {
				this.dirtyLevel = DirtyLevels.None;
				if (dirtyLevel === DirtyLevels.SideEffectsOnly) {
					let link = this.deps;
					while (link !== undefined) {
						const dep = link.dep;
						if ('notify' in dep) {
							dep.notify();
						}
						link = link.nextDep;
					}
				}
			}
		}
	}

	run(): T {
		const prevSub = startTrack(this);
		try {
			return this.fn();
		} finally {
			endTrack(this, prevSub);
		}
	}

	stop(): void {
		if (this.deps !== undefined) {
			clearTrack(this.deps);
			this.deps = undefined;
			this.depsTail = undefined;
		}
		this.dirtyLevel = DirtyLevels.None;
	}
}
