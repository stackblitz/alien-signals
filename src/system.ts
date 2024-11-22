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
	lastTrackedId: number;
}

export interface Subscriber {
	flags: SubscriberFlags;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

export interface Link {
	dep: Dependency | IComputed | (Dependency & IEffect);
	sub: Subscriber | IComputed | (Dependency & IEffect) | IEffect;
	version: number;
	// Reuse to link prev stack in checkDirty
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	// Reuse to link prev stack in propagate
	// Reuse to link next released link in linkPool
	nextDep: Link | undefined;
}

export const enum SubscriberFlags {
	None = 0,
	Tracking = 1 << 0,
	CanPropagate = 1 << 1,
	RunInnerEffects = 1 << 2,
	ToCheckDirty = 1 << 3,
	Dirty = 1 << 4,
	Dirtys = ToCheckDirty | Dirty,
}

let batchDepth = 0;
let queuedEffects: IEffect | undefined;
let queuedEffectsTail: IEffect | undefined;
let linkPool: Link | undefined;

export function startBatch(): void {
	++batchDepth;
}

export function endBatch(): void {
	if (--batchDepth === 0) {
		drainQueuedEffects();
	}
}

function drainQueuedEffects(): void {
	while (queuedEffects !== undefined) {
		const effect = queuedEffects;
		const queuedNext = effect.nextNotify;
		if (queuedNext !== undefined) {
			effect.nextNotify = undefined;
			queuedEffects = queuedNext;
		} else {
			queuedEffects = undefined;
			queuedEffectsTail = undefined;
		}
		effect.notify();
	}
}

export function link(dep: Dependency, sub: Subscriber): Link {
	const depsTail = sub.depsTail;
	const oldDep = depsTail !== undefined
		? depsTail.nextDep
		: sub.deps;
	if (oldDep !== undefined && oldDep.dep === dep) {
		sub.depsTail = oldDep;
		return oldDep;
	} else {
		return linkNewDep(dep, sub, oldDep, depsTail);
	}
}

function linkNewDep(dep: Dependency, sub: Subscriber, old: Link | undefined, depsTail: Link | undefined): Link {
	let newLink: Link;

	if (linkPool !== undefined) {
		newLink = linkPool;
		linkPool = newLink.nextDep;
		newLink.nextDep = old;
		newLink.dep = dep;
		newLink.sub = sub;
	} else {
		newLink = {
			dep,
			sub,
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
	let targetFlag = SubscriberFlags.Dirty;
	let stack = 0;
	let nextSub: Link | undefined;

	top: do {
		const sub = subs.sub;

		if ((sub.flags & SubscriberFlags.Tracking) === 0) {
			let canPropagate = (sub.flags >> 2) === 0;

			if (!canPropagate && (sub.flags & SubscriberFlags.CanPropagate) !== 0) {
				sub.flags &= ~SubscriberFlags.CanPropagate;
				canPropagate = true;
			}

			sub.flags |= targetFlag;

			if (canPropagate) {
				if ('subs' in sub && sub.subs !== undefined) {
					sub.depsTail!.nextDep = subs;
					subs = sub.subs;
					if ('notify' in sub) {
						targetFlag = SubscriberFlags.RunInnerEffects;
					} else {
						targetFlag = SubscriberFlags.ToCheckDirty;
					}
					++stack;

					continue;
				}
				if ('notify' in sub) {
					if (queuedEffectsTail !== undefined) {
						queuedEffectsTail.nextNotify = sub;
					} else {
						queuedEffects = sub;
					}
					queuedEffectsTail = sub;
				}
			}
		} else {
			let tracking = false;
			const depsTail = sub.depsTail;
			if (depsTail !== undefined) {
				let link = sub.deps!;
				do {
					if (link === subs) {
						tracking = true;
						break;
					}
					if (link === depsTail) {
						break;
					}
					link = link.nextDep!;
				} while (link !== undefined);
			}
			if (tracking) {
				const canPropagate = (sub.flags >> 2) === 0;

				sub.flags |= targetFlag;

				if (canPropagate) {
					sub.flags |= SubscriberFlags.CanPropagate;

					if ('subs' in sub && sub.subs !== undefined) {
						sub.depsTail!.nextDep = subs;
						subs = sub.subs;
						if ('notify' in sub) {
							targetFlag = SubscriberFlags.RunInnerEffects;
						} else {
							targetFlag = SubscriberFlags.ToCheckDirty;
						}
						++stack;

						continue;
					}
				}
			}
		}

		if ((nextSub = subs.nextSub) === undefined) {
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
							targetFlag = SubscriberFlags.Dirty;
						} else {
							targetFlag = SubscriberFlags.ToCheckDirty;
						}
						continue top;
					}
					dep = prevLink.dep as Subscriber;
				} while (stack > 0);
			}
			break;
		}
		subs = nextSub;
	} while (true);

	if (batchDepth === 0) {
		drainQueuedEffects();
	}
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
				if ((dep.flags & SubscriberFlags.Dirty) !== 0) {
					dirty = dep.update();
				} else if ((dep.flags & SubscriberFlags.ToCheckDirty) !== 0) {
					dep.subs!.prevSub = deps;
					deps = dep.deps!;
					++stack;
					continue;
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
						sub.flags &= ~SubscriberFlags.Dirtys;
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

export function startTrack(sub: Subscriber): void {
	sub.depsTail = undefined;
	sub.flags = SubscriberFlags.Tracking;
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
	sub.flags &= ~SubscriberFlags.Tracking;
}

export function clearTrack(link: Link): void {
	do {
		const dep = link.dep;
		const nextDep = link.nextDep;
		const nextSub = link.nextSub;
		const prevSub = link.prevSub;

		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
			dep.lastTrackedId = 0;
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
		link.nextDep = linkPool;
		linkPool = link;

		if (dep.subs === undefined && 'deps' in dep) {
			if ('notify' in dep) {
				dep.flags = SubscriberFlags.None;
			} else {
				dep.flags |= SubscriberFlags.Dirty;
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
