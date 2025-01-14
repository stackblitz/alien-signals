export * from './system.js';

import { createReactiveSystem, Dependency, Subscriber, SubscriberFlags } from './system.js';

interface Effect extends Subscriber, Dependency {
	fn(): void;
}

interface Computed<T = any> extends Signal<T | undefined>, Subscriber {
	getter: (cachedValue?: T) => T;
}

interface Signal<T = any> extends Dependency {
	currentValue: T;
}

type WriteableSignal<T> = {
	(): T;
	(value: T): void;
};

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
				return true;
			}
			return false;
		} finally {
			activeSub = prevSub;
			endTracking(computed);
		}
	},
	notifyEffect(e: Effect) {
		const flags = e.flags;
		if (
			flags & SubscriberFlags.Dirty
			|| (flags & SubscriberFlags.PendingComputed && updateDirtyFlag(e, flags))
		) {
			executeEffect(e);
		} else {
			processPendingInnerEffects(e, e.flags);
		}
		return true;
	},
});
const pauseStack: (Subscriber | undefined)[] = [];

let batchDepth = 0;
let activeSub: Subscriber | undefined;

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
		subs: undefined,
		subsTail: undefined,
	}) as WriteableSignal<T | undefined>;
}

export function computed<T>(getter: (cachedValue?: T) => T): () => T {
	return computedGetter.bind({
		currentValue: undefined,
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
	}
	executeEffect(e);
	return effectStop.bind(e);
}
//#endregion

//#region Internal functions
function executeEffect(e: Effect): void {
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
//#endregion

//#region Bound functions
function computedGetter<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (flags & (SubscriberFlags.Dirty | SubscriberFlags.PendingComputed)) {
		processComputedUpdate(this, flags);
	}
	if (activeSub !== undefined) {
		link(this, activeSub);
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
