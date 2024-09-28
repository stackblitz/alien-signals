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
	private pool: Link[] = [];

	getLink(dep: Dependency, sub: Subscriber): Link {
		if (this.pool.length > 0) {
			const link = this.pool.pop()!;
			link.dep = dep;
			link.sub = sub;
			link.prevSub = null;
			link.nextSub = null;
			return link;
		} else {
			return new Link(dep, sub);
		}
	}

	releaseLink(link: Link) {
		const { nextSub, prevSub, dep } = link;

		if (nextSub) {
			nextSub.prevSub = prevSub;
		} else {
			dep.lastSub = prevSub;
		}

		if (prevSub) {
			prevSub.nextSub = nextSub;
		} else {
			dep.firstSub = nextSub;
		}

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
		if (activeSubsDepth - pausedSubsIndex <= 0) {
			return;
		}
		const sub = activeSub!;
		if (dep.subVersion === sub.version) {
			return;
		}
		dep.subVersion = sub.version;
		const old = sub.lastDep
			? sub.lastDep.nextDep
			: sub.firstDep;
		if (old?.dep !== dep) {
			if (old) {
				linkPool.releaseLink(old);
			}
			const newLink = linkPool.getLink(dep, sub);
			if (!sub.lastDep) {
				sub.firstDep = newLink;
				sub.lastDep = newLink;
			}
			else {
				sub.lastDep!.nextDep = newLink;
				sub.lastDep = newLink;
			}
			if (!dep.firstSub) {
				dep.firstSub = newLink;
				dep.lastSub = newLink;
			}
			else {
				newLink.prevSub = dep.lastSub;
				dep.lastSub!.nextSub = newLink;
				dep.lastSub = newLink;
			}
		}
		else {
			sub.lastDep = old;
		}
	}

	export function broadcast(dep: Dependency) {
		let dirtyLevel = DirtyLevels.Dirty;
		let currentSubHead: Link | null = dep.firstSub;
		let lastSubHead = currentSubHead;

		while (currentSubHead) {
			let current: Link | null = currentSubHead;
			while (current) {
				const sub = current.sub;
				const subDirtyLevel = sub.dirtyLevel;

				if (subDirtyLevel === DirtyLevels.NotDirty) {
					if ('firstSub' in sub && sub.firstSub) {
						lastSubHead!.broadcastNext = sub.firstSub;
						lastSubHead = lastSubHead!.broadcastNext;
					}
					if ('queue' in sub && !sub.queuedNext && sub !== queuedEffectLast) {
						if (queuedEffectLast) {
							queuedEffectLast.queuedNext = sub;
							queuedEffectLast = sub;
						}
						else {
							queuedEffectFirst = sub;
							queuedEffectLast = sub;
						}
					}
				}

				if (subDirtyLevel < dirtyLevel) {
					sub.dirtyLevel = dirtyLevel;
				}

				current = current.nextSub;
			}
			dirtyLevel = DirtyLevels.MaybeDirty;
			const { broadcastNext } = currentSubHead;
			currentSubHead.broadcastNext = null;
			currentSubHead = broadcastNext;
		}
	}
}

export namespace Subscriber {

	export function isDirty(sub: Subscriber) {
		while (sub.dirtyLevel === DirtyLevels.MaybeDirty) {
			sub.dirtyLevel = DirtyLevels.QueryingDirty;
			const { lastDep } = sub;
			if (lastDep) {
				const resumeIndex = pauseTracking();
				let link = sub.firstDep;
				while (link) {
					if ('get' in link.dep) {
						link.dep.get();
						if (sub.dirtyLevel >= DirtyLevels.Dirty) {
							break;
						}
					}
					if (link === lastDep) {
						break;
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
		Subscriber.preTrack(sub);
		return lastActiveSub;
	}

	export function trackEnd(sub: Subscriber, lastActiveSub: Subscriber | null) {
		Subscriber.postTrack(sub);
		activeSubsDepth--;
		activeSub = lastActiveSub;
	}

	export function preTrack(sub: Subscriber) {
		sub.lastDep = null;
		sub.version = subVersion++;
	}

	export function postTrack(sub: Subscriber) {
		if (!sub.lastDep && sub.firstDep) {
			breakAllDeps(sub.firstDep);
			linkPool.releaseLink(sub.firstDep);
			sub.firstDep = null;
		}
		if (sub.lastDep) {
			breakAllDeps(sub.lastDep);
		}
		sub.dirtyLevel = DirtyLevels.NotDirty;
	}
}

function breakAllDeps(link: Link) {
	let toBreak: Link | null = link;
	while (toBreak?.nextDep) {
		const { nextDep }: Link = toBreak;
		toBreak.nextDep = null;
		linkPool.releaseLink(nextDep);
		toBreak = nextDep;
	}
}

let activeSub: Subscriber | null = null;
let activeSubsDepth = 0;
let pausedSubsIndex = 0;
let batchDepth = 0;
let subVersion = 0;
let queuedEffectFirst: IEffect | null = null;
let queuedEffectLast: IEffect | null = null;

export function pauseTracking() {
	const lastPausedIndex = pausedSubsIndex;
	pausedSubsIndex = activeSubsDepth;
	return lastPausedIndex;
}

export function resetTracking(lastPausedIndex: number) {
	pausedSubsIndex = lastPausedIndex;
}

export function batchStart() {
	batchDepth++;
}

export function batchEnd() {
	batchDepth--;
	while (!batchDepth && queuedEffectFirst) {
		const effect = queuedEffectFirst;
		const { queuedNext } = queuedEffectFirst;
		if (queuedNext) {
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
