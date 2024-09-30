export interface ISignal<T = any> {
	get(): T;
}

export interface IEffect {
	queuedNext: IEffect | null;
	queue(): void;
}

export interface Dependency {
	firstSub: Link | null;
	lastSub: Link | null;
	subVersion: number;
}

export interface Subscriber {
	dirtyLevel: DirtyLevels;
	version: number;
	firstDep: Link | null;
	lastDep: Link | null;
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

		if (nextSub !== null) {
			nextSub.prevSub = prevSub;
		}
		if (prevSub !== null) {
			prevSub.nextSub = nextSub;
		}

		if (nextSub === null) {
			dep.lastSub = prevSub;
		}
		if (prevSub === null) {
			dep.firstSub = nextSub;
		}

		// @ts-ignore
		link.dep = null;
		// @ts-ignore
		link.sub = null;
		link.prevSub = null;
		link.nextSub = null;
		link.nextDep = null;

		this.pool.push(link);
	}
}

const linkPool = new LinkPool();

export class Link {
	prevSub: Link | null = null;
	nextSub: Link | null = null;
	nextDep: Link | null = null;
	broadcastNext: Link | null = null;

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
		const old = sub.lastDep !== null
			? sub.lastDep.nextDep
			: sub.firstDep;
		if (old === null || old.dep !== dep) {
			const newLink = linkPool.getLink(dep, sub);
			if (old !== null) {
				const nextDep = old.nextDep;
				linkPool.releaseLink(old);
				newLink.nextDep = nextDep;
			}
			if (sub.lastDep === null) {
				sub.lastDep = sub.firstDep = newLink;
			}
			else {
				sub.lastDep = sub.lastDep!.nextDep = newLink;
			}
			if (dep.firstSub === null) {
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

		while (currentSubs !== null) {
			dep = currentSubs.dep;
			let subLink: Link | null = currentSubs;

			while (subLink !== null) {
				const sub = subLink.sub;
				const subDirtyLevel = sub.dirtyLevel;

				if (subDirtyLevel === DirtyLevels.NotDirty) {
					if ('firstSub' in sub && sub.firstSub !== null) {
						lastSubs = lastSubs.broadcastNext = sub.firstSub;
					}
					if ('queue' in sub) {
						if (queuedEffectLast !== null) {
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
			currentSubs.broadcastNext = null;
			currentSubs = broadcastNext;
		}
	}
}

export namespace Subscriber {

	export function isDirty(sub: Subscriber) {
		while (sub.dirtyLevel === DirtyLevels.MaybeDirty) {
			sub.dirtyLevel = DirtyLevels.QueryingDirty;
			const lastDep = sub.lastDep;
			if (lastDep !== null) {
				const resumeIndex = pauseTracking();
				let link = sub.firstDep;
				while (link !== null) {
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

	export function trackEnd(sub: Subscriber, lastActiveSub: Subscriber | null) {
		Subscriber.postTrack(sub);
		activeSubsDepth--;
		pausedSubs = activeSubsDepth - pausedSubsIndex <= 0;
		activeSub = lastActiveSub;
	}

	export function preTrack(sub: Subscriber) {
		sub.lastDep = null;
		sub.version = subVersion++;
	}

	export function postTrack(sub: Subscriber) {
		if (sub.lastDep === null && sub.firstDep !== null) {
			releaseAllDeps(sub.firstDep);
			linkPool.releaseLink(sub.firstDep);
			sub.firstDep = null;
		}
		if (sub.lastDep !== null) {
			releaseAllDeps(sub.lastDep);
		}
		sub.dirtyLevel = DirtyLevels.NotDirty;
	}
}

function releaseAllDeps(toBreak: Link) {
	let nextDep = toBreak.nextDep;
	while (nextDep !== null) {
		toBreak.nextDep = null;
		const nextNext = nextDep.nextDep;
		linkPool.releaseLink(nextDep);
		toBreak = nextDep;
		nextDep = nextNext;
	}
}

let activeSub: Subscriber | null = null;
let activeSubsDepth = 0;
let pausedSubsIndex = 0;
let pausedSubs = true;
let batchDepth = 0;
let subVersion = 0;
let queuedEffectFirst: IEffect | null = null;
let queuedEffectLast: IEffect | null = null;

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
	while (batchDepth === 0 && queuedEffectFirst !== null) {
		const effect = queuedEffectFirst;
		const queuedNext = queuedEffectFirst.queuedNext;
		if (queuedNext !== null) {
			queuedEffectFirst.queuedNext = null;
			queuedEffectFirst = queuedNext;
		}
		else {
			queuedEffectFirst = null;
			queuedEffectLast = null;
		}
		effect.queue();
	}
}
