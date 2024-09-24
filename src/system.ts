export const enum DirtyLevels {
	NotDirty,
	QueryingDirty,
	MaybeDirty,
	Dirty,
}

export class Subscribers extends Map<Subscriber, number> {
	constructor(public queryDirty?: () => void) {
		super();
	}
}

export class Subscriber {

	dirtyLevel = DirtyLevels.Dirty;
	shouldSpread = false;
	version = 0;
	runnings = 0;
	depsLength = 0;
	deps: Subscribers[] = [];
	depsDirty = false;

	constructor(
		public spread: () => void,
		public effect?: () => void,
	) { }

	get dirty() {
		while (this.dirtyLevel === DirtyLevels.MaybeDirty) {
			this.dirtyLevel = DirtyLevels.QueryingDirty;
			const lastPausedIndex = pausedTrackersIndex;
			pausedTrackersIndex = activeSubscribersDepth;
			for (let i = 0; i < this.depsLength; i++) {
				this.deps[i].queryDirty?.();
				if (this.dirtyLevel >= DirtyLevels.Dirty) {
					break;
				}
			}
			pausedTrackersIndex = lastPausedIndex;
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
let batchDepth = 0;
let pausedTrackersIndex = 0;

export function link(subs: Subscribers) {
	const activeSubscribersLength = activeSubscribersDepth - pausedTrackersIndex;
	if (!activeSubscriber || activeSubscribersLength <= 0) {
		return;
	}
	if (activeSubscriber.depsDirty) {
		if (subs.get(activeSubscriber) !== activeSubscriber.version) {
			subs.set(activeSubscriber, activeSubscriber.version);
		}
	}
	const oldDep = activeSubscriber.deps[activeSubscriber.depsLength];
	if (oldDep !== subs) {
		if (oldDep) {
			removeExpiredSubscriber(oldDep, activeSubscriber);
		}
		activeSubscriber.deps[activeSubscriber.depsLength++] = subs;
		if (!activeSubscriber.depsDirty) {
			activeSubscriber.depsDirty = true;
			activeSubscriber.version++;
			for (let i = 0; i < activeSubscriber.depsLength; i++) {
				const dep = activeSubscriber.deps[i];
				if (dep.get(activeSubscriber) !== activeSubscriber.version) {
					dep.set(activeSubscriber, activeSubscriber.version);
				}
			}
		}
	}
	else {
		activeSubscriber.depsLength++;
	}
}

export function track<T>(subscriber: Subscriber, fn: () => T) {
	const lastActiveSubscriber = activeSubscriber;
	try {
		activeSubscriber = subscriber;
		activeSubscribersDepth++;
		subscriber.runnings++;
		preTrack(subscriber);
		return fn();
	} finally {
		postTrack(subscriber);
		subscriber.runnings--;
		activeSubscribersDepth--;
		activeSubscriber = lastActiveSubscriber;
		if (!subscriber.runnings) {
			subscriber.dirtyLevel = DirtyLevels.NotDirty;
		}
	}
}

export function preTrack(subscriber: Subscriber) {
	subscriber.depsLength = 0;
	subscriber.depsDirty = false;
}

export function postTrack(subscriber: Subscriber) {
	if (subscriber.deps.length > subscriber.depsLength) {
		for (let i = subscriber.depsLength; i < subscriber.deps.length; i++) {
			removeExpiredSubscriber(subscriber.deps[i], subscriber);
		}
		subscriber.deps.length = subscriber.depsLength;
	}
}

function removeExpiredSubscriber(subs: Subscribers, subscriber: Subscriber) {
	const version = subs.get(subscriber);
	if (version !== undefined && subscriber.version !== version) {
		subs.delete(subscriber);
	}
}

export function trigger(subs: Subscribers, dirtyLevel: DirtyLevels) {
	batchStart();
	for (const [subscriber, version] of subs.entries()) {
		const subscribing = version === subscriber.version;
		if (!subscribing) {
			continue;
		}
		if (subscriber.dirtyLevel < dirtyLevel) {
			subscriber.shouldSpread ||= subscriber.dirtyLevel === DirtyLevels.NotDirty;
			subscriber.dirtyLevel = dirtyLevel;
		}
		if (subscriber.shouldSpread) {
			subscriber.shouldSpread = false;
			subscriber.spread();
			if (subscriber.effect) {
				queuedEffects.push(subscriber.effect);
			}
		}
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
