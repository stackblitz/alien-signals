export interface IEffect extends Subscriber {
	nextNotify: IEffect | undefined;
	notify(): void;
}

export interface IComputed extends Dependency, Subscriber {
	version: number;
	update(): boolean;
}

export interface Dependency {
	subs: Link | undefined;
	subsTail: Link | undefined;
}

export interface Subscriber {
	trackId: number;
	dirtyLevel: DirtyLevels;
	deps: Link | undefined;
	depsTail: Link | undefined;
	// This is an exception property used to handle the side effects of computed.
	// It will not be used in normal use cases, so we do not require it to be initialized.
	canPropagate?: boolean;
}

export interface Link {
	dep: Dependency | IComputed | (Dependency & IEffect);
	sub: Subscriber | IComputed | (Dependency & IEffect) | IEffect;
	trackId: number;
	version: number;
	// Reuse to link prev stack in checkDirty
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	// Reuse to link prev stack in propagate
	// Reuse to link next released link in linkPool
	nextDep: Link | undefined;
}

export const enum DirtyLevels {
	None,
	SideEffectsOnly,
	MaybeDirty,
	Dirty,
}

export const System = {
	activeSub: undefined as Subscriber | undefined,
	activeTrackId: 0,
	batchDepth: 0,
	lastTrackId: 0,
	queuedEffects: undefined as IEffect | undefined,
	queuedEffectsTail: undefined as IEffect | undefined,
	linkPool: undefined as Link | undefined,
};

export function startBatch(): void {
	++System.batchDepth;
}

export function endBatch(): void {
	--System.batchDepth;
	drainQueuedEffects();
}

export function drainQueuedEffects(): void {
	if (System.batchDepth === 0) {
		while (System.queuedEffects !== undefined) {
			const effect = System.queuedEffects;
			const queuedNext = effect.nextNotify;
			if (queuedNext !== undefined) {
				effect.nextNotify = undefined;
				System.queuedEffects = queuedNext;
			} else {
				System.queuedEffects = undefined;
				System.queuedEffectsTail = undefined;
			}
			effect.notify();
		}
	}
}

export function link(dep: Dependency, sub: Subscriber, trackId: number): Link {
	const depsTail = sub.depsTail;
	const oldDep = depsTail !== undefined
		? depsTail.nextDep
		: sub.deps;
	if (oldDep !== undefined && oldDep.dep === dep) {
		oldDep.trackId = trackId;
		sub.depsTail = oldDep;
		return oldDep;
	} else {
		return linkNewDep(dep, sub, trackId, oldDep, depsTail);
	}
}

function linkNewDep(dep: Dependency, sub: Subscriber, trackId: number, old: Link | undefined, depsTail: Link | undefined): Link {
	let newLink: Link;

	if (System.linkPool !== undefined) {
		newLink = System.linkPool;
		System.linkPool = newLink.nextDep;
		newLink.nextDep = old;
		newLink.dep = dep;
		newLink.sub = sub;
		newLink.trackId = trackId;
	} else {
		newLink = {
			dep,
			sub,
			trackId,
			version: 0,
			nextDep: old,
			prevSub: undefined,
			nextSub: undefined,
		};
	}

	if (depsTail === undefined) {
		sub.deps = newLink;
	} else {
		depsTail.nextDep = newLink;
	}

	if (dep.subs === undefined) {
		dep.subs = newLink;
	} else {
		const oldTail = dep.subsTail!;
		newLink.prevSub = oldTail;
		oldTail.nextSub = newLink;
	}

	sub.depsTail = newLink;
	dep.subsTail = newLink;

	return newLink;
}

export function propagate(subs: Link): void {
	let dirtyLevel = DirtyLevels.Dirty;
	let stack = 0;

	top: do {
		const sub = subs.sub;
		const subTrackId = sub.trackId;

		if (subTrackId < 0) {
			const subDirtyLevel = sub.dirtyLevel;
			const notDirty = subDirtyLevel === DirtyLevels.None;

			if (subDirtyLevel < dirtyLevel) {
				sub.dirtyLevel = dirtyLevel;
			}

			if (notDirty || sub.canPropagate) {
				if (!notDirty) {
					sub.canPropagate = false;
				}

				if ('subs' in sub && sub.subs !== undefined) {
					sub.depsTail!.nextDep = subs;
					subs = sub.subs;
					if ('notify' in sub) {
						dirtyLevel = DirtyLevels.SideEffectsOnly;
					} else {
						dirtyLevel = DirtyLevels.MaybeDirty;
					}
					++stack;

					continue;
				}
				if ('notify' in sub) {
					const queuedEffectsTail = System.queuedEffectsTail;
					if (queuedEffectsTail !== undefined) {
						queuedEffectsTail.nextNotify = sub;
					} else {
						System.queuedEffects = sub;
					}
					System.queuedEffectsTail = sub;
				}
			}
		} else if (subTrackId === subs.trackId) {
			const subDirtyLevel = sub.dirtyLevel;
			if (subDirtyLevel < dirtyLevel) {
				sub.dirtyLevel = dirtyLevel;
				if (subDirtyLevel === DirtyLevels.None) {
					sub.canPropagate = true;

					if ('subs' in sub && sub.subs !== undefined) {
						sub.depsTail!.nextDep = subs;
						subs = sub.subs;
						if ('notify' in sub) {
							dirtyLevel = DirtyLevels.SideEffectsOnly;
						} else {
							dirtyLevel = DirtyLevels.MaybeDirty;
						}
						++stack;

						continue;
					}
				}
			}
		}

		const nextSub = subs.nextSub;
		if (nextSub === undefined) {
			if (stack > 0) {
				let dep = subs.dep as Subscriber;
				do {
					--stack;
					const depsTail = dep.depsTail!;
					const prevLink = depsTail.nextDep!;
					depsTail.nextDep = undefined;
					subs = prevLink.nextSub!;

					if (subs !== undefined) {
						if (stack === 0) {
							dirtyLevel = DirtyLevels.Dirty;
						} else {
							dirtyLevel = DirtyLevels.MaybeDirty;
						}
						continue top;
					}
					dep = prevLink.dep as Subscriber;
				} while (stack > 0);
			}
			return;
		}
		subs = nextSub;
	} while (true);
}

export function checkDirty(deps: Link): boolean {
	let stack = 0;
	let dirty: boolean;
	let nextDep: Link | undefined;

	top: do {
		const dep = deps.dep;

		if ('update' in dep) {
			if (dep.version !== deps.version) {
				dirty = true;
			} else {
				const dirtyLevel = dep.dirtyLevel;
				if (dirtyLevel === DirtyLevels.MaybeDirty) {
					dep.subs!.prevSub = deps;
					deps = dep.deps!;
					++stack;
					continue;
				}
				if (dirtyLevel === DirtyLevels.Dirty && dep.update()) {
					dirty = true;
				} else {
					dirty = false;
				}
			}
		} else {
			dirty = false;
		}

		if (dirty || (nextDep = deps.nextDep) === undefined) {
			if (stack > 0) {
				let sub = deps.sub as IComputed;
				do {
					--stack;
					const subSubs = sub.subs!;
					const prevLink = subSubs.prevSub!;
					subSubs.prevSub = undefined;
					if (dirty) {
						if (sub.update()) {
							deps = prevLink;
							sub = prevLink.sub as IComputed;
							dirty = true;
							continue;
						}
					} else {
						sub.dirtyLevel = DirtyLevels.None;
					}
					deps = prevLink.nextDep!;
					if (deps !== undefined) {
						continue top;
					}
					sub = prevLink.sub as IComputed;
					dirty = false;
				} while (stack > 0);
			}
			return dirty;
		}
		deps = nextDep;
	} while (true);
}

export function startTrack(sub: Subscriber): number {
	const newTrackId = ++System.lastTrackId;
	sub.depsTail = undefined;
	sub.trackId = newTrackId;
	sub.dirtyLevel = DirtyLevels.None;
	return newTrackId;
}

export function endTrack(sub: Subscriber): void {
	const depsTail = sub.depsTail;
	if (depsTail !== undefined) {
		if (depsTail.nextDep !== undefined) {
			clearTrack(depsTail.nextDep);
			depsTail.nextDep = undefined;
		}
	} else if (sub.deps !== undefined) {
		clearTrack(sub.deps);
		sub.deps = undefined;
	}
	sub.trackId = -sub.trackId;
}

export function clearTrack(link: Link): void {
	do {
		const dep = link.dep;
		const nextDep = link.nextDep;
		const nextSub = link.nextSub;
		const prevSub = link.prevSub;

		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
		} else {
			dep.subsTail = prevSub;
		}

		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		} else {
			dep.subs = nextSub;
		}

		// @ts-expect-error
		link.dep = undefined;
		// @ts-expect-error
		link.sub = undefined;
		link.prevSub = undefined;
		link.nextSub = undefined;
		link.nextDep = System.linkPool;
		System.linkPool = link;

		if (dep.subs === undefined && 'deps' in dep) {
			if ('notify' in dep) {
				dep.dirtyLevel = DirtyLevels.None;
			} else {
				dep.dirtyLevel = DirtyLevels.Dirty;
			}
			const depDeps = dep.deps;
			if (depDeps !== undefined) {
				link = depDeps;
				dep.depsTail!.nextDep = nextDep;
				dep.deps = undefined;
				dep.depsTail = undefined;
				continue;
			}
		}
		link = nextDep!;
	} while (link !== undefined);
}
