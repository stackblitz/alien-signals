export * from './system.js';

import { createReactiveSystem, Dependency, Link, OneWayLink, Subscriber, SubscriberFlags } from './system.js';

interface EffectScope extends Subscriber {
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

const {
	link,
	propagate,
	shallowPropagate,
	checkDirty,
	startTracking,
	endTracking,
} = createReactiveSystem({
	updateComputed,
	notifyFlagsSet(sub: Effect | EffectScope) {
		if (queuedEffectsTail !== undefined) {
			queuedEffectsTail = queuedEffectsTail.linked = { target: sub, linked: undefined };
		} else {
			queuedEffectsTail = queuedEffects = { target: sub, linked: undefined };
		}
	},
	notifyFlagsUpdate() { },
});
const pauseStack: (Subscriber | undefined)[] = [];

export let batchDepth = 0;
let activeSub: Subscriber | undefined;
let activeScope: EffectScope | undefined;
let queuedEffects: OneWayLink<Effect | EffectScope> | undefined;
let queuedEffectsTail: OneWayLink<Effect | EffectScope> | undefined;

//#region Public functions
export function startBatch() {
	++batchDepth;
}

export function endBatch() {
	if (!--batchDepth) {
		processEffectNotifications();
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
		flags: SubscriberFlags.Computed | SubscriberFlags.Dirty,
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
		flags: SubscriberFlags.Effect,
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
		flags: SubscriberFlags.Effect,
		isScope: true,
	};
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
function updateComputed(computed: Computed): boolean {
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

function notifyEffect(e: Effect): void {
	const flags = e.flags;
	if (flags & (SubscriberFlags.Dirty | SubscriberFlags.Pending)) {
		if (flags & SubscriberFlags.Dirty || checkDirty(e.deps!)) {
			const prevSub = activeSub;
			activeSub = e;
			startTracking(e);
			try {
				e.fn();
			} finally {
				activeSub = prevSub;
				endTracking(e);
			}
		} else {
			e.flags = flags & ~SubscriberFlags.Pending;
			processPendingInnerEffects(e.deps!);
		}
	}
}

function notifyEffectScope(e: EffectScope): void {
	const flags = e.flags;
	if (flags & SubscriberFlags.Pending) {
		e.flags = flags & ~SubscriberFlags.Pending;
		processPendingInnerEffects(e.deps!);
	}
}

function processEffectNotifications(): void {
	while (queuedEffects !== undefined) {
		const effect = queuedEffects.target;
		if ((queuedEffects = queuedEffects.linked) === undefined) {
			queuedEffectsTail = undefined;
		}
		if ('isScope' in effect) {
			notifyEffectScope(effect);
		} else {
			notifyEffect(effect);
		}
	}
}

function processPendingInnerEffects(link: Link): void {
	do {
		const dep = link.dep;
		if (
			'flags' in dep
			&& dep.flags & SubscriberFlags.Effect
			&& dep.flags & (SubscriberFlags.Dirty | SubscriberFlags.Pending)
		) {
			notifyEffect(dep as Effect);
		}
		link = link.nextDep!;
	} while (link !== undefined);
}
//#endregion

//#region Bound functions
function computedGetter<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (flags & (SubscriberFlags.Dirty | SubscriberFlags.Pending)) {
		if (flags & SubscriberFlags.Dirty || checkDirty(this.deps!)) {
			if (updateComputed(this)) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		} else {
			this.flags = flags & ~SubscriberFlags.Pending;
		}
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
					processEffectNotifications();
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
