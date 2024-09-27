export interface IComputed<T = any> {
	get(): T;
}

export interface IEffect {
	queuedNext: IEffect | null;
	run(): void;
	stop(): void;
}

export interface Dependency {
	firstSub: Link | null;
	lastSub: Link | null;
	subVersion: number;
}

export interface Subscriber {
	dirtyLevel: DirtyLevels;
	version: number;
	depsLength: number;
	deps: Link[];
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
			link.prev = null;
			link.next = null;
			return link;
		} else {
			return new Link(dep, sub);
		}
	}

	releaseLink(link: Link) {
		const { next, prev, dep } = link;

		if (next) {
			next.prev = prev;
		} else {
			dep.lastSub = prev;
		}

		if (prev) {
			prev.next = next;
		} else {
			dep.firstSub = next;
		}

		this.pool.push(link);
	}
}

const linkPool = new LinkPool();

export class Link {
	prev: Link | null = null;
	next: Link | null = null;
	broadcastNext: Link | null = null;

	constructor(
		public dep: Dependency & ({} | IComputed),
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
		const old = sub.deps[sub.depsLength] as Link | undefined;
		if (old?.dep !== dep) {
			if (old) {
				linkPool.releaseLink(old);
			}
			const newLink = linkPool.getLink(dep, sub);
			sub.deps[sub.depsLength++] = newLink;
			if (!dep.firstSub) {
				dep.firstSub = newLink;
				dep.lastSub = newLink;
			}
			else {
				newLink.prev = dep.lastSub;
				dep.lastSub!.next = newLink;
				dep.lastSub = newLink;
			}
		}
		else {
			sub.depsLength++;
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
					if ('run' in sub && !sub.queuedNext && sub !== queuedEffectLast) {
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

				current = current.next;
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
			const lastPausedIndex = pausedSubsIndex;
			pausedSubsIndex = activeSubsDepth;
			const deps = sub.deps;
			const depsLength = sub.depsLength;
			for (let i = 0; i < depsLength; i++) {
				const dep = deps[i].dep;
				if ('get' in dep) {
					dep.get();
					if (sub.dirtyLevel >= DirtyLevels.Dirty) {
						break;
					}
				}
			}
			pausedSubsIndex = lastPausedIndex;
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
		sub.depsLength = 0;
		sub.version = subVersion++;
		return lastActiveSub;
	}

	export function trackEnd(sub: Subscriber, lastActiveSub: Subscriber | null) {
		const deps = sub.deps;
		const depsLength = sub.depsLength;
		if (deps.length > depsLength) {
			for (let i = depsLength; i < deps.length; i++) {
				linkPool.releaseLink(deps[i]);
			}
			deps.length = depsLength;
		}
		activeSubsDepth--;
		activeSub = lastActiveSub;
		sub.dirtyLevel = DirtyLevels.NotDirty;
	}
}


export let activeSub: Subscriber | null = null;
export let activeSubsDepth = 0;
export let pausedSubsIndex = 0;
export let batchDepth = 0;
export let subVersion = 0;
export let queuedEffectFirst: IEffect | null = null;
export let queuedEffectLast: IEffect | null = null;

export function setPausedSubsIndex(index: number) {
	pausedSubsIndex = index;
}

export function batchStart() {
	batchDepth++;
}

export function batchEnd() {
	batchDepth--;
	while (!batchDepth && queuedEffectFirst) {
		queuedEffectFirst.run();
		const { queuedNext } = queuedEffectFirst;
		if (queuedNext) {
			queuedEffectFirst.queuedNext = null;
			queuedEffectFirst = queuedNext;
		}
		else {
			queuedEffectFirst = null;
			queuedEffectLast = null;
		}
	}
}
