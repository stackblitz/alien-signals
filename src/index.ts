export * from './system.js';

import { createReactiveSystem, Dependency, Link, Subscriber, SubscriberFlags } from './system.js';

interface EffectScope extends Subscriber, Dependency {
	isScope: true;
}

interface Effect extends Subscriber, Dependency {
	fn(): void;
}

interface Computed<T = any> extends Signal<T | undefined>, Subscriber {
	getter: (previousValue?: T) => T;
}

interface Signal<T = any> extends Dependency {
	currentValue: T;
}

const pauseStack: (Subscriber | undefined)[] = [];
const queuedEffects: (Effect | EffectScope)[] = [];
const {
	link,
	unlink,
	propagate,
	shallowPropagate,
	checkDirty,
	startTracking,
	endTracking,
} = createReactiveSystem({
	update,
	notify: queueEffect,
	unwatched(sub: Signal | Effect | Computed) {
		if ('deps' in sub) {
			let toRemove = sub.deps;
			while (toRemove !== undefined) {
				toRemove = unlink(toRemove, sub);
			}
			const depFlags = sub.flags;
			if (!(depFlags & SubscriberFlags.Dirty)) {
				sub.flags = depFlags | SubscriberFlags.Dirty;
			}
		}
	},
});

export let batchDepth = 0;

let queuedEffectsLength = 0;
let activeSub: Subscriber | undefined;
let activeScope: EffectScope | undefined;

//#region Public functions
export function startBatch() {
	++batchDepth;
}

export function endBatch() {
	if (!--batchDepth) {
		notifyPendingEffects();
	}
}

export function pauseTracking() {
	pauseStack.push(activeSub);
	activeSub = undefined;
}

export function resumeTracking() {
	activeSub = pauseStack.pop();
}

export function signal<T>(): {
	(): T | undefined;
	(value: T | undefined): void;
};
export function signal<T>(initialValue: T): {
	(): T;
	(value: T): void;
};
export function signal<T>(initialValue?: T): {
	(): T | undefined;
	(value: T | undefined): void;
} {
	return signalGetterSetter.bind({
		currentValue: initialValue,
		subs: undefined,
		subsTail: undefined,
	}) as () => T | undefined;
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
	return computedGetter.bind({
		currentValue: undefined,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: SubscriberFlags.Mutable | SubscriberFlags.Dirty,
		getter: getter as (previousValue?: unknown) => unknown,
	}) as () => T;
}

export function effect<T>(fn: () => T): () => void {
	const e: Effect = {
		fn,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: SubscriberFlags.Watching,
	};
	if (activeSub !== undefined) {
		link(e, activeSub);
	} else if (activeScope !== undefined) {
		link(e, activeScope);
	}
	const prevSub = activeSub;
	activeSub = e;
	try {
		e.fn();
	} finally {
		activeSub = prevSub;
	}
	return effectStop.bind(e);
}

export function effectScope<T>(fn: () => T): () => void {
	const e: EffectScope = {
		deps: undefined,
		depsTail: undefined,
		subs: undefined,
		subsTail: undefined,
		flags: SubscriberFlags.Watching,
		isScope: true,
	};
	if (activeScope !== undefined) {
		link(e, activeScope);
	}
	const prevSub = activeScope;
	activeScope = e;
	try {
		fn();
	} finally {
		activeScope = prevSub;
	}
	return effectStop.bind(e);
}
//#endregion

//#region Internal functions
function update(computed: Computed): boolean {
	const prevSub = activeSub;
	activeSub = computed;
	startTracking(computed);
	try {
		const oldValue = computed.currentValue;
		const newValue = computed.getter(oldValue);
		if (oldValue !== newValue) {
			computed.currentValue = newValue;
			return true;
		}
		return false;
	} finally {
		activeSub = prevSub;
		endTracking(computed);
	}
}

function queueEffect(e: Effect | EffectScope) {
	e.flags &= ~SubscriberFlags.Watching;
	const subs = e.subs;
	if (subs !== undefined) {
		const parent = subs.sub;
		const parentFlags = parent.flags;
		if (parentFlags & SubscriberFlags.Watching) {
			parent.flags = parentFlags | SubscriberFlags.Pending;
			queueEffect(parent as Effect | EffectScope);
		}
	} else {
		queuedEffects[queuedEffectsLength++] = e;
	}
}

function notifyEffect(e: Effect): void {
	const flags = e.flags |= SubscriberFlags.Watching;
	if (
		flags & SubscriberFlags.Dirty
		|| (flags & SubscriberFlags.Pending && checkDirty(e.deps!))
	) {
		const prevSub = activeSub;
		activeSub = e;
		startTracking(e);
		try {
			e.fn();
		} finally {
			activeSub = prevSub;
			endTracking(e);
		}
	} else if (flags & SubscriberFlags.Pending) {
		e.flags = flags & ~SubscriberFlags.Pending;
		notifyInnerEffects(e.deps!);
	}
}

function notifyEffectScope(e: EffectScope): void {
	const flags = e.flags |= SubscriberFlags.Watching;
	if (flags & SubscriberFlags.Pending) {
		e.flags = flags & ~SubscriberFlags.Pending;
		notifyInnerEffects(e.deps!);
	}
}

function notifyPendingEffects(): void {
	++batchDepth;
	for (let i = 0; i < queuedEffectsLength; i++) {
		const effect = queuedEffects[i];
		// @ts-expect-error
		queuedEffects[i] = undefined;
		if ('isScope' in effect) {
			notifyEffectScope(effect);
		} else {
			notifyEffect(effect);
		}
	}
	queuedEffectsLength = 0;
	--batchDepth;
}

function notifyInnerEffects(link: Link): void {
	do {
		const dep = link.dep;
		if ('flags' in dep) {
			const flags = dep.flags;
			if (flags & (SubscriberFlags.Dirty | SubscriberFlags.Pending)) {
				if ('fn' in dep) {
					notifyEffect(dep as Effect);
				} else if ('isScope' in dep) {
					notifyEffectScope(dep as EffectScope);
				}
			}
		}
		link = link.nextDep!;
	} while (link !== undefined);
}
//#endregion

//#region Bound functions
function computedGetter<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (
		flags & SubscriberFlags.Dirty
		|| (flags & SubscriberFlags.Pending && checkDirty(this.deps!))
	) {
		if (update(this)) {
			const subs = this.subs;
			if (subs !== undefined) {
				shallowPropagate(subs);
			}
		}
	} else if (flags & SubscriberFlags.Pending) {
		this.flags = flags & ~SubscriberFlags.Pending;
	}
	if (activeSub !== undefined) {
		link(this, activeSub);
	} else if (activeScope !== undefined) {
		link(this, activeScope);
	}
	return this.currentValue!;
}

function signalGetterSetter<T>(this: Signal<T>, ...value: [T]): T | void {
	if (value.length) {
		if (this.currentValue !== (this.currentValue = value[0])) {
			const subs = this.subs;
			if (subs !== undefined) {
				propagate(subs);
				if (!batchDepth) {
					notifyPendingEffects();
				}
			}
		}
	} else {
		if (activeSub !== undefined) {
			link(this, activeSub);
		}
		return this.currentValue;
	}
}

function effectStop(this: Subscriber): void {
	startTracking(this);
	endTracking(this);
}
//#endregion
