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
}

export class Dependency {
	firstLink: Link | null = null;
	lastLink: Link | null = null;
	subscribeVersion = -1;

	constructor(
		public queryDirty: (() => void) | null = null
	) { }
}

export class Subscriber {
	dirtyLevel = DirtyLevels.Dirty;
	version = globalSubscriberVersion++;
	running = 0;
	depsLength = 0;
	deps: Link[] = [];

	constructor(
		public dep: Dependency | null = null,
		public effect: (() => void) | null = null,
	) { }
}

export function isDirty(sub: Subscriber) {
	while (sub.dirtyLevel === DirtyLevels.MaybeDirty) {
		sub.dirtyLevel = DirtyLevels.QueryingDirty;
		const lastPausedIndex = pausedSubscribersIndex;
		pausedSubscribersIndex = activeSubscribersDepth;
		for (let i = 0; i < sub.depsLength; i++) {
			sub.deps[i].dep.queryDirty?.();
			if (sub.dirtyLevel >= DirtyLevels.Dirty) {
				break;
			}
		}
		pausedSubscribersIndex = lastPausedIndex;
		if (sub.dirtyLevel === DirtyLevels.QueryingDirty) {
			sub.dirtyLevel = DirtyLevels.NotDirty;
		}
	}
	return sub.dirtyLevel === DirtyLevels.Dirty;
}

const queuedEffects: (() => void)[] = [];

let activeSubscriber: Subscriber | undefined;
let activeSubscribersDepth = 0;
let pausedSubscribersIndex = 0;
let batchDepth = 0;
let globalSubscriberVersion = 0;

export function link(dep: Dependency) {
	const activeSubscribersLength = activeSubscribersDepth - pausedSubscribersIndex;
	if (!activeSubscriber || activeSubscribersLength <= 0) {
		return;
	}
	if (dep.subscribeVersion === activeSubscriber.version) {
		return;
	}
	dep.subscribeVersion = activeSubscriber.version;
	const oldLink = activeSubscriber.deps[activeSubscriber.depsLength];
	if (oldLink?.dep !== dep) {
		if (oldLink) {
			breakLink(oldLink);
		}
		const newLink = new Link(dep, activeSubscriber);
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

export function broadcast(dep: Dependency) {
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
