import type { Computed } from './computed';
import type { Effect } from './effect';

export const enum DirtyLevels {
	NotDirty,
	QueryingDirty,
	MaybeDirty,
	Dirty,
}

export class Link {
	prev: Link | null = null;
	next: Link | null = null;

	constructor(
		public dep: Dependency,
		public sub: Subscriber
	) { }

	break() {
		if (this.next) {
			this.next.prev = this.prev;
		}
		else {
			this.dep.lastLink = this.prev;
		}
		if (this.prev) {
			this.prev.next = this.next;
		}
		else {
			this.dep.firstLink = this.next;
		}
	}
}

export class Dependency {
	firstLink: Link | null = null;
	lastLink: Link | null = null;
	subscribeVersion = -1;

	constructor(
		public computed: Computed | null = null,
	) { }

	link() {
		const activeSubscribersLength = activeSubscribersDepth - pausedSubscribersIndex;
		if (!activeSubscriber || activeSubscribersLength <= 0) {
			return;
		}
		if (this.subscribeVersion === activeSubscriber.version) {
			return;
		}
		this.subscribeVersion = activeSubscriber.version;
		const oldLink = activeSubscriber.deps[activeSubscriber.depsLength] as Link | undefined;
		if (oldLink?.dep !== this) {
			oldLink?.break();
			const newLink = new Link(this, activeSubscriber);
			activeSubscriber.deps[activeSubscriber.depsLength++] = newLink;
			if (!this.firstLink) {
				this.firstLink = newLink;
				this.lastLink = newLink;
			}
			else {
				newLink.prev = this.lastLink;
				this.lastLink!.next = newLink;
				this.lastLink = newLink;
			}
		}
		else {
			activeSubscriber.depsLength++;
		}
	}

	broadcast() {
		batchStart();
		const queuedDeps: Dependency[] = [this];
		let dirtyLevel = DirtyLevels.Dirty;
		let i = 0;
		while (i < queuedDeps.length) {
			let currentLink = queuedDeps[i++].firstLink;
			while (currentLink) {
				if (currentLink.sub.dirtyLevel === DirtyLevels.NotDirty) {
					if (currentLink.sub.dep) {
						queuedDeps.push(currentLink.sub.dep);
					}
					if (currentLink.sub.effect) {
						queuedEffects.push(currentLink.sub.effect);
					}
				}
				if (currentLink.sub.dirtyLevel < dirtyLevel) {
					currentLink.sub.dirtyLevel = dirtyLevel;
				}
				currentLink = currentLink.next;
			}
			dirtyLevel = DirtyLevels.MaybeDirty;
		}
		batchEnd();
	}
}

export class Subscriber {
	dirtyLevel = DirtyLevels.Dirty;
	version = globalSubscriberVersion++;
	running = 0;
	depsLength = 0;
	deps: Link[] = [];

	constructor(
		public dep: Dependency | null = null,
		public effect: Effect | null = null,
	) { }

	isDirty() {
		while (this.dirtyLevel === DirtyLevels.MaybeDirty) {
			this.dirtyLevel = DirtyLevels.QueryingDirty;
			const lastPausedIndex = pausedSubscribersIndex;
			pausedSubscribersIndex = activeSubscribersDepth;
			for (let i = 0; i < this.depsLength; i++) {
				this.deps[i].dep.computed?.get();
				if (this.dirtyLevel >= DirtyLevels.Dirty) {
					break;
				}
			}
			pausedSubscribersIndex = lastPausedIndex;
			if (this.dirtyLevel === DirtyLevels.QueryingDirty) {
				this.dirtyLevel = DirtyLevels.NotDirty;
			}
		}
		return this.dirtyLevel === DirtyLevels.Dirty;
	}

	trackStart() {
		const lastActiveSubscriber = activeSubscriber;
		activeSubscriber = this;
		activeSubscribersDepth++;
		this.running++;
		this.preTrack();
		return lastActiveSubscriber;
	}

	trackEnd(lastActiveSubscriber: Subscriber | undefined) {
		this.postTrack();
		this.running--;
		activeSubscribersDepth--;
		activeSubscriber = lastActiveSubscriber;
		if (!this.running) {
			this.dirtyLevel = DirtyLevels.NotDirty;
		}
	}

	preTrack() {
		this.depsLength = 0;
		this.version = globalSubscriberVersion++;
	}

	postTrack() {
		if (this.deps.length > this.depsLength) {
			for (let i = this.depsLength; i < this.deps.length; i++) {
				this.deps[i].break();
			}
			this.deps.length = this.depsLength;
		}
	}
}

const queuedEffects: Effect[] = [];

let activeSubscriber: Subscriber | undefined;
let activeSubscribersDepth = 0;
let pausedSubscribersIndex = 0;
let batchDepth = 0;
let globalSubscriberVersion = 0;

export function batchStart() {
	batchDepth++;
}

export function batchEnd() {
	batchDepth--;
	while (!batchDepth && queuedEffects.length) {
		queuedEffects.shift()!.run();
	}
}
