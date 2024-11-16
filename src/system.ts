export interface IEffect extends Subscriber {
	nextNotify: IEffect | undefined;
	notify(): void;
}

export interface IComputed extends Dependency, Subscriber {
	update(): boolean;
}

export interface Dependency {
	subs: Link | undefined;
	subsTail: Link | undefined;
}

export interface Subscriber {
	trackId: number;
	canPropagate: boolean;
	dirtyLevel: DirtyLevels;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

export interface Link {
	dep: Dependency | IComputed | (Dependency & IEffect);
	sub: Subscriber | IComputed | (Dependency & IEffect) | IEffect;
	trackId: number;
	// Also used as prev propagate, prev update
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	// Also used next released
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
	if (--System.batchDepth === 0) {
		drainQueuedEffects();
	}
}

export function drainQueuedEffects(): void {
	let effect = System.queuedEffects;
	while (effect !== undefined) {
		const queuedNext = effect.nextNotify;
		if (queuedNext !== undefined) {
			effect.nextNotify = undefined;
			effect.notify();
			effect = queuedNext;
		} else {
			System.queuedEffects = undefined;
			System.queuedEffectsTail = undefined;
			effect.notify();
			effect = System.queuedEffects;
		}
	}
}

export function link(dep: Dependency, sub: Subscriber): void {
	const depsTail = sub.depsTail;
	const old = depsTail !== undefined
		? depsTail.nextDep
		: sub.deps;

	if (old === undefined || old.dep !== dep) {
		let newLink: Link;

		if (System.linkPool !== undefined) {
			newLink = System.linkPool;
			System.linkPool = newLink.nextDep;
			newLink.nextDep = old;
			newLink.dep = dep;
			newLink.sub = sub;
			newLink.trackId = sub.trackId;
		} else {
			newLink = {
				dep,
				sub,
				trackId: sub.trackId,
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
	} else {
		old.trackId = sub.trackId;
		sub.depsTail = old;
	}
}

export function propagate(subs: Link): void {
	let link = subs;
	let dirtyLevel = DirtyLevels.Dirty;
	let stack = 0;

	top: do {
		const sub: Link['sub'] = link.sub;
		const subTrackId = sub.trackId;

		if (subTrackId > 0) {
			if (subTrackId === link.trackId) {
				const subDirtyLevel = sub.dirtyLevel;
				if (subDirtyLevel < dirtyLevel) {
					sub.dirtyLevel = dirtyLevel;
					if (subDirtyLevel === DirtyLevels.None) {
						sub.canPropagate = true;

						if ('subs' in sub && sub.subs !== undefined) {
							subs = sub.subs;
							subs.prevSub = link;
							link = subs;
							if ('notify' in sub) {
								dirtyLevel = DirtyLevels.SideEffectsOnly;
							} else {
								dirtyLevel = DirtyLevels.MaybeDirty;
							}
							stack++;

							continue;
						}
					}
				}
			}
		} else if (subTrackId === -link.trackId) {

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
					subs = sub.subs;
					subs.prevSub = link;
					link = subs;
					if ('notify' in sub) {
						dirtyLevel = DirtyLevels.SideEffectsOnly;
					} else {
						dirtyLevel = DirtyLevels.MaybeDirty;
					}
					stack++;

					continue;
				} else if ('notify' in sub) {
					const queuedEffectsTail = System.queuedEffectsTail;
					if (queuedEffectsTail !== undefined) {
						queuedEffectsTail.nextNotify = sub;
					} else {
						System.queuedEffects = sub;
					}
					System.queuedEffectsTail = sub;
				}
			}
		}

		link = link.nextSub!;
		if (link === undefined) {
			while (stack-- > 0) {
				const prevLink = subs.prevSub!;
				subs.prevSub = undefined;
				subs = prevLink.dep.subs!;
				link = prevLink.nextSub!;

				if (link !== undefined) {
					if (stack === 0) {
						dirtyLevel = DirtyLevels.Dirty;
					} else {
						dirtyLevel = DirtyLevels.MaybeDirty;
					}
					continue top;
				}
			}
			return;
		}
	} while (true);
}

export function checkDirty(link: Link, depth = 0): boolean {
	do {
		const dep = link.dep;
		if ('update' in dep) {
			const dirtyLevel = dep.dirtyLevel;
			if (dirtyLevel !== DirtyLevels.None) {
				if (
					dirtyLevel === DirtyLevels.Dirty
					|| (
						depth < 4
							? checkDirty(dep.deps!, depth + 1)
							: checkDirtyNonRecursive(dep)
					)
				) {
					if (dep.update()) {
						propagate(dep.subs!);
						return true;
					}
				} else {
					dep.dirtyLevel = DirtyLevels.None;
				}
			}
		}
		link = link.nextDep!;
	} while (link !== undefined);
	return false;
}

function checkDirtyNonRecursive(sub: Link['sub']): boolean {
	let link = sub.deps!;
	let stack = 0;

	top: do {
		const dep = link.dep;

		if ('update' in dep) {
			const dirtyLevel = dep.dirtyLevel;
			if (dirtyLevel === DirtyLevels.MaybeDirty) {
				dep.subs!.prevSub = link;
				sub = dep;
				link = dep.deps!;
				stack++;
				continue;
			}
			if (dirtyLevel === DirtyLevels.Dirty) {
				if (dep.update()) {
					propagate(dep.subs!);
					let dirty = true;
					while (stack-- > 0) {
						const subSubs = (sub as IComputed).subs!;
						const prevLink = subSubs.prevSub!;
						subSubs.prevSub = undefined;
						if (dirty) {
							if ((sub as IComputed).update()) {
								propagate(subSubs);
								sub = prevLink.sub;
								dirty = true;
								continue;
							}
						} else {
							sub.dirtyLevel = DirtyLevels.None;
						}
						link = prevLink.nextDep!;
						sub = prevLink.sub;
						if (link !== undefined) {
							continue top;
						}
						dirty = false;
					}
					return dirty;
				}
			}
		}

		link = link.nextDep!;
		if (link === undefined) {
			let dirty = false;
			while (stack-- > 0) {
				const subSubs = (sub as IComputed).subs!;
				const prevLink = subSubs.prevSub!;
				subSubs.prevSub = undefined;
				if (dirty) {
					if ((sub as IComputed).update()) {
						propagate(subSubs);
						sub = prevLink.sub;
						dirty = true;
						continue;
					}
				} else {
					sub.dirtyLevel = DirtyLevels.None;
				}
				link = prevLink.nextDep!;
				sub = prevLink.sub;
				if (link !== undefined) {
					continue top;
				}
				dirty = false;
			}
			return dirty;
		}
	} while (true);
}

export function startTrack(sub: Subscriber): Subscriber | undefined {
	const newTrackId = System.lastTrackId + 1;
	const prevSub = System.activeSub;

	System.activeSub = sub;
	System.activeTrackId = newTrackId;
	System.lastTrackId = newTrackId;

	sub.depsTail = undefined;
	sub.trackId = newTrackId;
	sub.dirtyLevel = DirtyLevels.None;

	return prevSub;
}

export function endTrack(sub: Subscriber, prevSub: Subscriber | undefined): void {
	if (prevSub !== undefined) {
		System.activeSub = prevSub;
		System.activeTrackId = prevSub.trackId;
	} else {
		System.activeSub = undefined;
		System.activeTrackId = 0;
	}

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
			link.dep.subsTail = prevSub;
		}

		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		} else {
			link.dep.subs = nextSub;
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
			if (dep.deps !== undefined) {
				link = dep.deps;
				dep.depsTail!.nextDep = nextDep;
				dep.deps = undefined;
				dep.depsTail = undefined;
				continue;
			}
		}
		link = nextDep!;
	} while (link !== undefined);
}
