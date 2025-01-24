export * from './system.js';

import { createReactiveSystem, Dependency, Subscriber, SubscriberFlags } from './system.js';

interface EffectScope extends Subscriber {
	isScope: true;
}

interface Effect extends Subscriber, Dependency {
	fn(): void;
}

interface Computed<T = any> extends Signal<T | undefined>, Subscriber {
	getter: (cachedValue?: T) => T;
}

interface Signal<T = any> extends Dependency {
	version: number;
	currentValue: T;
}

interface WriteableSignal<T> {
	(): T;
	(value: T): void;
}

const {
	link,
	propagate,
	updateDirtyFlag,
	startTracking,
	endTracking,
	processEffectNotifications,
	processComputedUpdate,
	processPendingInnerEffects,
} = createReactiveSystem({
	updateComputed(computed: Computed): boolean {
		const prevSub = activeSub;
		activeSub = computed;
		startTracking(computed);
		try {
			const oldValue = computed.currentValue;
			const newValue = computed.getter(oldValue);
			if (oldValue !== newValue) {
				computed.currentValue = newValue;
				computed.version++;
				return true;
			}
			return false;
		} finally {
			activeSub = prevSub;
			endTracking(computed);
		}
	},
	notifyEffect(e: Effect | EffectScope) {
		if ('isScope' in e) {
			return notifyEffectScope(e);
		} else {
			return notifyEffect(e);
		}
	},
});
const pauseStack: (Subscriber | undefined)[] = [];
const nursery: Subscriber = {
	flags: SubscriberFlags.None,
	deps: undefined,
	depsTail: undefined,
};

let batchDepth = 0;
let activeSub: Subscriber | undefined;
let activeScope: EffectScope | undefined;
let pendingTriggerCooling = false;

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

export function signal<T>(): WriteableSignal<T | undefined>;
export function signal<T>(oldValue: T): WriteableSignal<T>;
export function signal<T>(oldValue?: T): WriteableSignal<T | undefined> {
	return signalGetterSetter.bind({
		currentValue: oldValue,
		version: 0,
		subs: undefined,
		subsTail: undefined,
	}) as WriteableSignal<T | undefined>;
}

export function computed<T>(getter: (cachedValue?: T) => T): () => T {
	return computedGetter.bind({
		currentValue: undefined,
		version: 0,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: SubscriberFlags.Computed | SubscriberFlags.Dirty,
		getter: getter as (cachedValue?: unknown) => unknown,
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
	runEffect(e);
	return effectStop.bind(e);
}

export function effectScope<T>(fn: () => T): () => void {
	const e: EffectScope = {
		deps: undefined,
		depsTail: undefined,
		flags: SubscriberFlags.Effect,
		isScope: true,
	};
	runEffectScope(e, fn);
	return effectStop.bind(e);
}
//#endregion

//#region Internal functions
function runEffect(e: Effect): void {
	const prevSub = activeSub;
	activeSub = e;
	startTracking(e);
	try {
		e.fn();
	} finally {
		activeSub = prevSub;
		endTracking(e);
	}
}

function runEffectScope(e: EffectScope, fn: () => void): void {
	const prevSub = activeScope;
	activeScope = e;
	startTracking(e);
	try {
		fn();
	} finally {
		activeScope = prevSub;
		endTracking(e);
	}
}

function notifyEffect(e: Effect): boolean {
	const flags = e.flags;
	if (
		flags & SubscriberFlags.Dirty
		|| (flags & SubscriberFlags.PendingComputed && updateDirtyFlag(e, flags))
	) {
		runEffect(e);
	} else {
		processPendingInnerEffects(e, e.flags);
	}
	return true;
}

function notifyEffectScope(e: EffectScope): boolean {
	const flags = e.flags;
	if (flags & SubscriberFlags.PendingEffect) {
		processPendingInnerEffects(e, e.flags);
		return true;
	}
	return false;
}
//#endregion

//#region Bound functions
function computedGetter<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (flags & (SubscriberFlags.Dirty | SubscriberFlags.PendingComputed)) {
		processComputedUpdate(this, flags);
	}
	if (activeSub !== undefined) {
		link(this, activeSub);
	} else if (activeScope !== undefined) {
		link(this, activeScope);
	} else if (this.subs === undefined) {
		link(this, nursery);
		if (!pendingTriggerCooling) {
			pendingTriggerCooling = true;
			triggerCooling();
		}
	}
	return this.currentValue!;
}

async function triggerCooling() {
	await Promise.resolve();
	pendingTriggerCooling = false;
	startTracking(nursery);
	endTracking(nursery);
}

function signalGetterSetter<T>(this: Signal<T>, ...value: [T]): T | void {
	if (value.length) {
		if (this.currentValue !== (this.currentValue = value[0])) {
			this.version++;
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
