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

const pauseStack: (ReactiveNode | undefined)[] = [];
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
			return updateSignal(signal, signal.value);
		}
	},
	notify,
	unwatched(signal: Signal | Effect | Computed) {
		let toRemove = signal.deps;
		if (toRemove !== undefined) {
			do {
				toRemove = unlink(toRemove, signal);
			} while (toRemove !== undefined);
			signal.flags |= ReactiveFlags.Dirty;
		}
	},
});

export let batchDepth = 0;

let notifyIndex = 0;
let queuedEffectsLength = 0;
let activeSub: ReactiveNode | undefined;
let activeScope: EffectScope | undefined;

export function getCurrentSub(): ReactiveNode | undefined {
	return activeSub;
}

export function setCurrentSub(sub: ReactiveNode | undefined) {
	const prevSub = activeSub;
	activeSub = sub;
	return prevSub;
}

export function getCurrentScope(): EffectScope | undefined {
	return activeScope;
}

export function setCurrentScope(scope: EffectScope | undefined) {
	const prevScope = activeScope;
	activeScope = scope;
	return prevScope;
}

export function startBatch() {
	++batchDepth;
}

export function endBatch() {
	if (!--batchDepth) {
		flush();
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
	return signalOper.bind({
		previousValue: initialValue,
		value: initialValue,
		subs: undefined,
		subsTail: undefined,
		flags: ReactiveFlags.Mutable,
	}) as () => T | undefined;
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
	return computedOper.bind({
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
	const prev = setCurrentSub(e);
	try {
		e.fn();
	} finally {
		setCurrentSub(prev);
	}
	return effectOper.bind(e);
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
	const prev = setCurrentScope(e);
	try {
		fn();
	} finally {
		setCurrentScope(prev);
	}
	return effectOper.bind(e);
}

function updateComputed(c: Computed): boolean {
	const prevSub = setCurrentSub(c);
	startTracking(c);
	try {
		const oldValue = c.value;
		return oldValue !== (c.value = c.getter(oldValue));
	} finally {
		setCurrentSub(prevSub);
		endTracking(c);
	}
}

function updateSignal(s: Signal, value: any): boolean {
	s.flags = ReactiveFlags.Mutable;
	return s.previousValue !== (s.previousValue = value);
}

function notify(e: Effect | EffectScope) {
	const flags = e.flags;
	if (!(flags & EffectFlags.Queued)) {
		e.flags = flags | EffectFlags.Queued;
		const subs = e.subs;
		if (subs !== undefined) {
			notify(subs.sub as Effect | EffectScope);
		} else {
			queuedEffects[queuedEffectsLength++] = e;
		}
	}
}

function run(e: Effect | EffectScope, flags: ReactiveFlags): void {
	if (
		flags & ReactiveFlags.Dirty
		|| (flags & ReactiveFlags.Pending && checkDirty(e.deps!, e))
	) {
		const prev = setCurrentSub(e);
		startTracking(e);
		try {
			(e as Effect).fn();
		} finally {
			setCurrentSub(prev);
			endTracking(e);
		}
		return;
	} else if (flags & ReactiveFlags.Pending) {
		e.flags = flags & ~ReactiveFlags.Pending;
	}
	let link = e.deps;
	while (link !== undefined) {
		const dep = link.dep;
		const depFlags = dep.flags;
		if (depFlags & EffectFlags.Queued) {
			run(dep, dep.flags = depFlags & ~EffectFlags.Queued);
		}
		link = link.nextDep;
	}
}

function flush(): void {
	while (notifyIndex < queuedEffectsLength) {
		const effect = queuedEffects[notifyIndex];
		// @ts-expect-error
		queuedEffects[notifyIndex++] = undefined;
		run(effect, effect.flags &= ~EffectFlags.Queued);
	}
	notifyIndex = 0;
	queuedEffectsLength = 0;
}

function computedOper<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (
		flags & ReactiveFlags.Dirty
		|| (flags & ReactiveFlags.Pending && checkDirty(this.deps!, this))
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

function signalOper<T>(this: Signal<T>, ...value: [T]): T | void {
	if (value.length) {
		const newValue = value[0];
		if (this.value !== (this.value = newValue)) {
			this.flags = ReactiveFlags.Mutable | ReactiveFlags.Dirty;
			const subs = this.subs;
			if (subs !== undefined) {
				propagate(subs);
				if (!batchDepth) {
					flush();
				}
			}
		}
	} else {
		const value = this.value;
		if (this.flags & ReactiveFlags.Dirty) {
			if (updateSignal(this, value)) {
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

function effectOper(this: Effect | EffectScope): void {
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
