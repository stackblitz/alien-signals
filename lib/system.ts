export interface ISignal<T = any> {
	get(): T;
}

export interface IEffect {
	queuedNext: IEffect | undefined;
	queue(): void;
}

export interface Dependency {
	firstSub: Link | undefined;
	lastSub: Link | undefined;
	subVersion: number;
}

export interface Subscriber {
	dirtyLevel: DirtyLevels;
	version: number;
	firstDep: Link | undefined;
	lastDep: Link | undefined;
}

export const enum DirtyLevels {
	NotDirty,
	QueryingDirty,
	MaybeDirty,
	Dirty,
}

class LinkPool {
	pool: Link[] = [];

	getLink(dep: Dependency, sub: Subscriber): Link {
		if (this.pool.length > 0) {
			const link = this.pool.pop()!;
			link.dep = dep;
			link.sub = sub;
			return link;
		} else {
			return new Link(dep, sub);
		}
	}

	releaseLink(link: Link) {
		const { nextSub, prevSub, dep } = link;

		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		}

		if (nextSub === undefined) {
			dep.lastSub = prevSub;
		}
		if (prevSub === undefined) {
			dep.firstSub = nextSub;
		}

		// @ts-ignore
		link.dep = undefined;
		// @ts-ignore
		link.sub = undefined;
		link.prevSub = undefined;
		link.nextSub = undefined;
		link.nextDep = undefined;

		this.pool.push(link);
	}
}

const linkPool = new LinkPool();

export class Link {
	prevSub: Link | undefined = undefined;
	nextSub: Link | undefined = undefined;
	nextDep: Link | undefined = undefined;
	broadcastNext: Link | undefined = undefined;

	constructor(
		public dep: Dependency & ({} | ISignal),
		public sub: Subscriber & ({} | IEffect | Dependency)
	) { }
}

export namespace Dependency {

	export function link(dep: Dependency) {
		if (pausedSubs) {
			return;
		}
		if (dep.subVersion === activeSub!.version) {
			return;
		}
		const sub = activeSub!;
		dep.subVersion = sub.version;
		const old = sub.lastDep !== undefined
			? sub.lastDep.nextDep
			: sub.firstDep;
		if (old === undefined || old.dep !== dep) {
			const newLink = linkPool.getLink(dep, sub);
			if (old !== undefined) {
				const nextDep = old.nextDep;
				linkPool.releaseLink(old);
				newLink.nextDep = nextDep;
			}
			if (sub.lastDep === undefined) {
				sub.lastDep = sub.firstDep = newLink;
			}
			else {
				sub.lastDep = sub.lastDep!.nextDep = newLink;
			}
			if (dep.firstSub === undefined) {
				dep.lastSub = dep.firstSub = newLink;
			}
			else {
				newLink.prevSub = dep.lastSub;
				dep.lastSub = dep.lastSub!.nextSub = newLink;
			}
		}
		else {
			sub.lastDep = old;
		}
	}

	export function broadcast(dep: Dependency) {
		let dirtyLevel = DirtyLevels.Dirty;
		let currentSubs = dep.firstSub;
		let lastSubs = currentSubs!;

		while (currentSubs !== undefined) {
			let subLink: Link | undefined = currentSubs;

			while (subLink !== undefined) {
				const sub = subLink.sub;
				const subDirtyLevel = sub.dirtyLevel;

				if (subDirtyLevel === DirtyLevels.NotDirty) {
					if ('firstSub' in sub && sub.firstSub !== undefined) {
						lastSubs = lastSubs.broadcastNext = sub.firstSub;
					}
					if ('queue' in sub) {
						if (queuedEffectLast !== undefined) {
							queuedEffectLast = queuedEffectLast.queuedNext = sub;
						}
						else {
							queuedEffectFirst = queuedEffectLast = sub;
						}
					}
				}

				if (subDirtyLevel < dirtyLevel) {
					sub.dirtyLevel = dirtyLevel;
				}

				subLink = subLink.nextSub;
			}

			dirtyLevel = DirtyLevels.MaybeDirty;
			const broadcastNext = currentSubs.broadcastNext;
			currentSubs.broadcastNext = undefined;
			currentSubs = broadcastNext;
		}
	}
}

export namespace Subscriber {

	export function isDirty(sub: Subscriber) {
		while (sub.dirtyLevel === DirtyLevels.MaybeDirty) {
			sub.dirtyLevel = DirtyLevels.QueryingDirty;
			const lastDep = sub.lastDep;
			if (lastDep !== undefined) {
				const resumeIndex = pauseTracking();
				let link = sub.firstDep;
				while (link !== undefined) {
					if ('get' in link.dep) {
						link.dep.get();
						if (sub.dirtyLevel >= DirtyLevels.Dirty) {
							break;
						}
					}
					link = link.nextDep;
				}
				resetTracking(resumeIndex);
			}
			if (sub.dirtyLevel === DirtyLevels.QueryingDirty) {
				sub.dirtyLevel = DirtyLevels.NotDirty;
			}
		}
		return sub.dirtyLevel === DirtyLevels.Dirty;
	}

	export function trackStart(sub: Subscriber) {
		const lastActiveSub = activeSub;
		activeSub = sub;
		activeSubsDepth++;
		pausedSubs = false;
		Subscriber.preTrack(sub);
		return lastActiveSub;
	}

	export function trackEnd(sub: Subscriber, lastActiveSub: Subscriber | undefined) {
		Subscriber.postTrack(sub);
		activeSubsDepth--;
		pausedSubs = activeSubsDepth - pausedSubsIndex <= 0;
		activeSub = lastActiveSub;
	}

	export function preTrack(sub: Subscriber) {
		sub.lastDep = undefined;
		sub.version = subVersion++;
	}

	export function postTrack(sub: Subscriber) {
		if (sub.lastDep === undefined && sub.firstDep !== undefined) {
			releaseAllDeps(sub.firstDep);
			linkPool.releaseLink(sub.firstDep);
			sub.firstDep = undefined;
		}
		if (sub.lastDep !== undefined) {
			releaseAllDeps(sub.lastDep);
		}
		sub.dirtyLevel = DirtyLevels.NotDirty;
	}
}

function releaseAllDeps(toBreak: Link) {
	let nextDep = toBreak.nextDep;
	while (nextDep !== undefined) {
		toBreak.nextDep = undefined;
		const nextNext = nextDep.nextDep;
		linkPool.releaseLink(nextDep);
		toBreak = nextDep;
		nextDep = nextNext;
	}
}

let activeSub: Subscriber | undefined = undefined;
let activeSubsDepth = 0;
let pausedSubsIndex = 0;
let pausedSubs = true;
let batchDepth = 0;
let subVersion = 0;
let queuedEffectFirst: IEffect | undefined = undefined;
let queuedEffectLast: IEffect | undefined = undefined;

export function pauseTracking() {
	const lastPausedIndex = pausedSubsIndex;
	pausedSubsIndex = activeSubsDepth;
	pausedSubs = true;
	return lastPausedIndex;
}

export function resetTracking(lastPausedIndex: number) {
	pausedSubsIndex = lastPausedIndex;
	pausedSubs = activeSubsDepth - pausedSubsIndex <= 0;
}

export function batchStart() {
	batchDepth++;
}

export function batchEnd() {
	batchDepth--;
	while (batchDepth === 0 && queuedEffectFirst !== undefined) {
		const effect = queuedEffectFirst;
		const queuedNext = queuedEffectFirst.queuedNext;
		if (queuedNext !== undefined) {
			queuedEffectFirst.queuedNext = undefined;
			queuedEffectFirst = queuedNext;
		}
		else {
			queuedEffectFirst = undefined;
			queuedEffectLast = undefined;
		}
		effect.queue();
	}
}
