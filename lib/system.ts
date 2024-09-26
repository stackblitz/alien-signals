export interface IComputed {
	get(): any;
}

export interface IEffect {
	run(): void;
	stop(): void;
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
		this.pool.push(link);
	}
}

const linkPool = new LinkPool();

export class Link {
	prev: Link | null = null;
	next: Link | null = null;
	broadcastNext: Link | null = null;

	constructor(
		public dep: Dependency,
		public sub: Subscriber
	) { }

	break() {
		const { next, prev, dep } = this;

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

		linkPool.releaseLink(this);
	}
}

export class Dependency {
	firstSub: Link | null = null;
	lastSub: Link | null = null;
	subVersion = -1;

	constructor(
		public computed: IComputed | null = null,
	) { }

	link() {
		if (activeSubsDepth - pausedSubsIndex <= 0) {
			return;
		}
		const sub = activeSub!;
		if (this.subVersion === sub.version) {
			return;
		}
		this.subVersion = sub.version;
		const old = sub.deps[sub.depsLength] as Link | undefined;
		if (old?.dep !== this) {
			old?.break();
			const newLink = linkPool.getLink(this, sub);
			sub.deps[sub.depsLength++] = newLink;
			if (!this.firstSub) {
				this.firstSub = newLink;
				this.lastSub = newLink;
			}
			else {
				newLink.prev = this.lastSub;
				this.lastSub!.next = newLink;
				this.lastSub = newLink;
			}
		}
		else {
			sub.depsLength++;
		}
	}

	broadcast() {
		let dirtyLevel = DirtyLevels.Dirty;
		let currentSubHead: Link | null = this.firstSub;
		let lastSubHead = currentSubHead;

		while (currentSubHead) {
			let current: Link | null = currentSubHead;
			while (current) {
				const sub = current.sub;
				const subDirtyLevel = sub.dirtyLevel;

				if (subDirtyLevel === DirtyLevels.NotDirty) {
					const subDep = sub.dep;
					const subEffect = sub.effect;

					if (subDep?.firstSub) {
						lastSubHead!.broadcastNext = subDep.firstSub;
						lastSubHead = lastSubHead!.broadcastNext;
					}
					if (subEffect) {
						queuedEffects.push(subEffect);
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

export class Subscriber {
	dirtyLevel = DirtyLevels.Dirty;
	version = -1;
	depsLength = 0;
	deps: Link[] = [];
	lastActiveSub: Subscriber | null = null;

	constructor(
		public dep: Dependency | null = null,
		public effect: IEffect | null = null,
	) { }

	isDirty() {
		while (this.dirtyLevel === DirtyLevels.MaybeDirty) {
			this.dirtyLevel = DirtyLevels.QueryingDirty;
			const lastPausedIndex = pausedSubsIndex;
			pausedSubsIndex = activeSubsDepth;
			const deps = this.deps;
			const depsLength = this.depsLength;
			for (let i = 0; i < depsLength; i++) {
				deps[i].dep.computed?.get();
				if (this.dirtyLevel >= DirtyLevels.Dirty) {
					break;
				}
			}
			pausedSubsIndex = lastPausedIndex;
			if (this.dirtyLevel === DirtyLevels.QueryingDirty) {
				this.dirtyLevel = DirtyLevels.NotDirty;
			}
		}
		return this.dirtyLevel === DirtyLevels.Dirty;
	}

	trackStart() {
		this.lastActiveSub = activeSub;
		activeSub = this;
		activeSubsDepth++;
		this.depsLength = 0;
		this.version = subVersion++;
	}

	trackEnd() {
		const deps = this.deps;
		const depsLength = this.depsLength;
		if (deps.length > depsLength) {
			for (let i = depsLength; i < deps.length; i++) {
				deps[i].break();
			}
			deps.length = depsLength;
		}
		activeSubsDepth--;
		activeSub = this.lastActiveSub;
		this.lastActiveSub = null;
		this.dirtyLevel = DirtyLevels.NotDirty;
	}
}

export const queuedEffects: IEffect[] = [];

export let activeSub: Subscriber | null = null;
export let activeSubsDepth = 0;
export let pausedSubsIndex = 0;
export let batchDepth = 0;
export let subVersion = 0;

export function setPausedSubsIndex(index: number) {
	pausedSubsIndex = index;
}

export function batchStart() {
	batchDepth++;
}

export function batchEnd() {
	batchDepth--;
	while (!batchDepth && queuedEffects.length) {
		queuedEffects.shift()!.run();
	}
}
