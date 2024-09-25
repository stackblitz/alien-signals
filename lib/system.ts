export const enum DirtyLevels {
	NotDirty,
	QueryingDirty,
	MaybeDirty,
	Dirty,
}

export interface Link {
	dep: Dep;
	sub: Subscriber;
	prev?: Link;
	next?: Link;
}

export interface Dep {
	firstLink?: Link;
	lastLink?: Link;
	queryDirty?(): void;
	subscriberVersion?: number;
}

export class Subscriber {
	dirtyLevel = DirtyLevels.Dirty;
	version = globalSubscriberVersion++;
	running = 0;
	depsLength = 0;
	deps: Link[] = [];

	constructor(
		public dep: Dep | undefined,
		public effect?: () => void,
	) { }

	get dirty() {
		while (this.dirtyLevel === DirtyLevels.MaybeDirty) {
			this.dirtyLevel = DirtyLevels.QueryingDirty;
			const lastPausedIndex = pausedSubscribersIndex;
			pausedSubscribersIndex = activeSubscribersDepth;
			for (let i = 0; i < this.depsLength; i++) {
				this.deps[i].dep.queryDirty?.();
				if (this.dirtyLevel >= DirtyLevels.Dirty) {
					break;
				}
			}
			pausedSubscribersIndex = lastPausedIndex;
			if (this.dirtyLevel === DirtyLevels.QueryingDirty) {
				this.dirtyLevel = DirtyLevels.NotDirty;
			}
		}
		return this.dirtyLevel >= DirtyLevels.Dirty;
	}
}

const queuedEffects: (() => void)[] = [];

let activeSubscriber: Subscriber | undefined;
let activeSubscribersDepth = 0;
let pausedSubscribersIndex = 0;
let batchDepth = 0;
let globalSubscriberVersion = 0;

export function link(dep: Dep) {
	const activeSubscribersLength = activeSubscribersDepth - pausedSubscribersIndex;
	if (!activeSubscriber || activeSubscribersLength <= 0) {
		return;
	}
	if (dep.subscriberVersion === activeSubscriber.version) {
		return;
	}
	dep.subscriberVersion = activeSubscriber.version;
	const oldLink = activeSubscriber.deps[activeSubscriber.depsLength];
	if (oldLink?.dep !== dep) {
		if (oldLink) {
			breakLink(oldLink);
		}
		const newLink: Link = {
			dep,
			sub: activeSubscriber,
		};
		activeSubscriber.deps[activeSubscriber.depsLength++] = newLink;
		if (!dep.firstLink) {
			dep.firstLink = newLink;
			dep.lastLink = newLink;
		}
		else {
			newLink.prev = dep.lastLink;
			dep.lastLink!.next = newLink;
			dep.lastLink = newLink;
		}
	}
	else {
		activeSubscriber.depsLength++;
	}
}

function breakLink(oldLink: Link) {
	if (oldLink.next) {
		oldLink.next.prev = oldLink.prev;
	}
	else {
		oldLink.dep.lastLink = oldLink.prev;
	}
	if (oldLink.prev) {
		oldLink.prev.next = oldLink.next;
	}
	else {
		oldLink.dep.firstLink = oldLink.next;
	}
}

export function track<T>(subscriber: Subscriber, fn: () => T) {
	const lastActiveSubscriber = activeSubscriber;
	try {
		activeSubscriber = subscriber;
		activeSubscribersDepth++;
		subscriber.running++;
		preTrack(subscriber);
		return fn();
	} finally {
		postTrack(subscriber);
		subscriber.running--;
		activeSubscribersDepth--;
		activeSubscriber = lastActiveSubscriber;
		if (!subscriber.running) {
			subscriber.dirtyLevel = DirtyLevels.NotDirty;
		}
	}
}

export function preTrack(subscriber: Subscriber) {
	subscriber.depsLength = 0;
	subscriber.version = globalSubscriberVersion++;
}

export function postTrack(subscriber: Subscriber) {
	if (subscriber.deps.length > subscriber.depsLength) {
		for (let i = subscriber.depsLength; i < subscriber.deps.length; i++) {
			breakLink(subscriber.deps[i]);
		}
		subscriber.deps.length = subscriber.depsLength;
	}
}

export function broadcast(dep: Dep) {
	batchStart();
	const queuedDeps = [dep];
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

export function batchStart() {
	batchDepth++;
}

export function batchEnd() {
	batchDepth--;
	while (!batchDepth && queuedEffects.length) {
		queuedEffects.shift()!();
	}
}
