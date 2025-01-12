export * from './system.js';

import { createSystem, Dependency, Subscriber, SubscriberFlags } from './system.js';

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
	endTrack,
	isDirty,
	processPendingInnerEffects,
	processEffectNotifications,
	processComputedUpdate,
	link,
	propagate,
	startTrack,
} = createSystem({
	updateComputed(computed: Computed): boolean {
		const prevSub = activeSub;
		activeSub = computed;
		startTrack(computed);
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
			endTrack(computed);
		}
	},
	notifyEffect(e: Effect) {
		const flags = e.flags;
		if (isDirty(e, flags)) {
			runEffect(e);
		} else if (flags & SubscriberFlags.InnerEffectsPending) {
			e.flags &= ~SubscriberFlags.InnerEffectsPending;
			processPendingInnerEffects(e.deps!);
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
	return signalGetSet.bind({
		currentValue: oldValue,
		subs: undefined,
		subsTail: undefined,
	}) as WriteableSignal<T | undefined>;
}

export function computed<T>(getter: (cachedValue?: T) => T): () => T {
	return computedGet.bind({
		currentValue: undefined,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: SubscriberFlags.IsComputed | SubscriberFlags.Dirty,
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
		flags: SubscriberFlags.IsEffect,
	};
	if (activeSub !== undefined) {
		link(e, activeSub);
	}
	runEffect(e);
	return effectStop.bind(e);
}
//#endregion

//#region Internal functions
function runEffect(e: Effect): void {
	const prevSub = activeSub;
	activeSub = e;
	startTrack(e);
	try {
		e.fn();
	} finally {
		activeSub = prevSub;
		endTrack(e);
	}
}
//#endregion

//#region Bound functions
function computedGet<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (flags) {
		processComputedUpdate(this, flags);
	}
	if (activeSub !== undefined) {
		link(this, activeSub);
	}
	return this.currentValue!;
}

function signalGetSet<T>(this: Signal<T>, ...value: [T]): T | void {
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
	startTrack(this);
	endTrack(this);
}
//#endregion
