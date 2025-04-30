export * from './system.js';

import { createReactiveSystem, ReactiveNode, ReactiveFlags } from './system.js';

const enum EffectFlags {
	Queued = 1 << 6,
}

interface EffectScope extends ReactiveNode { }

interface Effect extends ReactiveNode {
	fn(): void;
}

interface Computed<T = any> extends ReactiveNode {
	value: T | undefined;
	getter: (previousValue?: T) => T;
}

interface Signal<T = any> extends ReactiveNode {
	previousValue: T;
	value: T;
}

const pauseStack: (Computed | Effect | undefined)[] = [];
const queuedEffects: (Effect | EffectScope)[] = [];
const {
	link,
	unlink,
	propagate,
	checkDirty,
	endTracking,
	startTracking,
	shallowPropagate,
} = createReactiveSystem({
	update(signal: Signal | Computed): boolean {
		if ('getter' in signal) {
			return updateComputed(signal);
		} else {
			return signal.previousValue !== (signal.previousValue = signal.value);
		}
	},
	notify: queueEffect,
	unwatched(signal: Signal | Effect | Computed) {
		let toRemove = signal.deps;
		if (toRemove !== undefined) {
			do {
				toRemove = unlink(toRemove, signal);
			} while (toRemove !== undefined);
			const flags = signal.flags;
			if (!(flags & ReactiveFlags.Dirty)) {
				signal.flags = flags | ReactiveFlags.Dirty;
			}
		}
	},
});

export let batchDepth = 0;

let notifyIndex = 0;
let queuedEffectsLength = 0;
let activeSub: Computed | Effect | undefined;
let activeScope: EffectScope | undefined;

//#region Public functions
export function startBatch() {
	++batchDepth;
}

export function endBatch() {
	if (!--batchDepth) {
		runQueuedEffects();
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
		previousValue: initialValue,
		value: initialValue,
		subs: undefined,
		subsTail: undefined,
		flags: ReactiveFlags.Mutable,
	}) as () => T | undefined;
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
	return computedGetter.bind({
		value: undefined,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: ReactiveFlags.Mutable | ReactiveFlags.Dirty,
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
		flags: ReactiveFlags.Watching,
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
		flags: ReactiveFlags.None,
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
function updateComputed(signal: Computed): boolean {
	const prevSub = activeSub;
	activeSub = signal;
	startTracking(signal);
	try {
		const oldValue = signal.value;
		return oldValue !== (signal.value = signal.getter(oldValue));
	} finally {
		activeSub = prevSub;
		endTracking(signal);
	}
}

function queueEffect(e: Effect | EffectScope) {
	const flags = e.flags;
	if (!(flags & EffectFlags.Queued)) {
		e.flags = flags | EffectFlags.Queued;
		const subs = e.subs;
		if (subs !== undefined) {
			queueEffect(subs.sub as Effect | EffectScope);
		} else {
			queuedEffects[queuedEffectsLength++] = e;
		}
	}
}

function runEffect(e: Effect | EffectScope, flags: ReactiveFlags): void {
	if (
		flags & ReactiveFlags.Dirty
		|| (flags & ReactiveFlags.Pending && checkDirty(e.deps!))
	) {
		const prevSub = activeSub;
		activeSub = e as Effect;
		startTracking(e);
		try {
			(e as Effect).fn();
		} finally {
			activeSub = prevSub;
			endTracking(e);
		}
	} else {
		let link = e.deps;
		while (link !== undefined) {
			const dep = link.dep;
			const depFlags = dep.flags;
			if (depFlags & EffectFlags.Queued) {
				runEffect(dep, dep.flags = depFlags & ~EffectFlags.Queued);
			}
			link = link.nextDep;
		}
	}
}

function runQueuedEffects(): void {
	while (notifyIndex < queuedEffectsLength) {
		const effect = queuedEffects[notifyIndex];
		// @ts-expect-error
		queuedEffects[notifyIndex++] = undefined;
		runEffect(effect, effect.flags &= ~EffectFlags.Queued);
	}
	notifyIndex = 0;
	queuedEffectsLength = 0;
}
//#endregion

//#region Bound functions
function computedGetter<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (
		flags & ReactiveFlags.Dirty
		|| (flags & ReactiveFlags.Pending && checkDirty(this.deps!))
	) {
		if (updateComputed(this)) {
			const subs = this.subs;
			if (subs !== undefined) {
				shallowPropagate(subs);
			}
		}
	} else if (flags & ReactiveFlags.Pending) {
		this.flags = flags & ~ReactiveFlags.Pending;
	}
	if (activeSub !== undefined) {
		link(this, activeSub);
	} else if (activeScope !== undefined) {
		link(this, activeScope);
	}
	return this.value!;
}

function signalGetterSetter<T>(this: Signal<T>, ...value: [T]): T | void {
	if (value.length) {
		const newValue = value[0];
		if (this.value !== (this.value = newValue)) {
			this.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;
			const subs = this.subs;
			if (subs !== undefined) {
				propagate(subs);
				if (!batchDepth) {
					runQueuedEffects();
				}
			}
		}
	} else {
		const value = this.value;
		if (this.flags & ReactiveFlags.Dirty) {
			this.flags = ReactiveFlags.Mutable;
			if (this.previousValue !== (this.previousValue = value)) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		}
		if (activeSub !== undefined) {
			link(this, activeSub);
		}
		return value;
	}
}

function effectStop(this: Effect | EffectScope): void {
	let dep = this.deps;
	while (dep !== undefined) {
		dep = unlink(dep, this);
	}
	let sub = this.subs;
	while (sub !== undefined) {
		unlink(sub);
		sub = this.subs;
	}
	this.flags = ReactiveFlags.None;
}
//#endregion
