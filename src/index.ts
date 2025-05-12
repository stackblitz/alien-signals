export * from './system.js';

import { createReactiveSystem, type ReactiveNode, type ReactiveFlags } from './system.js';

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
const queuedEffects: (Effect | EffectScope | undefined)[] = [];
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
	unwatched(node: Signal | Computed | Effect | EffectScope) {
		if ('getter' in node) {
			let toRemove = node.deps;
			if (toRemove !== undefined) {
				node.flags = 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty;
				do {
					toRemove = unlink(toRemove, node);
				} while (toRemove !== undefined);
			}
		} else if (!('previousValue' in node)) {
			effectOper.call(node);
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

/**
 * @deprecated Will be removed in the next major version. Use `const pausedSub = setCurrentSub(undefined)` instead for better performance.
 */
export function pauseTracking() {
	pauseStack.push(setCurrentSub(undefined));
}

/**
 * @deprecated Will be removed in the next major version. Use `setCurrentSub(pausedSub)` instead for better performance.
 */
export function resumeTracking() {
	setCurrentSub(pauseStack.pop());
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
		flags: 1 satisfies ReactiveFlags.Mutable,
	}) as () => T | undefined;
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
	return computedOper.bind({
		value: undefined,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty,
		getter: getter as (previousValue?: unknown) => unknown,
	}) as () => T;
}

export function effect(fn: () => void): () => void {
	const e: Effect = {
		fn,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: 2 satisfies ReactiveFlags.Watching,
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

export function effectScope(fn: () => void): () => void {
	const e: EffectScope = {
		deps: undefined,
		depsTail: undefined,
		subs: undefined,
		subsTail: undefined,
		flags: 0 satisfies ReactiveFlags.None,
	};
	if (activeScope !== undefined) {
		link(e, activeScope);
	}
	const prevSub = setCurrentSub(undefined);
	const prevScope = setCurrentScope(e);
	try {
		fn();
	} finally {
		setCurrentScope(prevScope);
		setCurrentSub(prevSub);
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
	s.flags = 1 satisfies ReactiveFlags.Mutable;
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
		flags & 16 satisfies ReactiveFlags.Dirty
		|| (flags & 32 satisfies ReactiveFlags.Pending && checkDirty(e.deps!, e))
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
	} else if (flags & 32 satisfies ReactiveFlags.Pending) {
		e.flags = flags & ~(32 satisfies ReactiveFlags.Pending);
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
		const effect = queuedEffects[notifyIndex]!;
		queuedEffects[notifyIndex++] = undefined;
		run(effect, effect.flags &= ~EffectFlags.Queued);
	}
	notifyIndex = 0;
	queuedEffectsLength = 0;
}

function computedOper<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (
		flags & 16 satisfies ReactiveFlags.Dirty
		|| (flags & 32 satisfies ReactiveFlags.Pending && checkDirty(this.deps!, this))
	) {
		if (updateComputed(this)) {
			const subs = this.subs;
			if (subs !== undefined) {
				shallowPropagate(subs);
			}
		}
	} else if (flags & 32 satisfies ReactiveFlags.Pending) {
		this.flags = flags & ~(32 satisfies ReactiveFlags.Pending);
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
			this.flags = 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty;
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
		if (this.flags & 16 satisfies ReactiveFlags.Dirty) {
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
	const sub = this.subs;
	if (sub !== undefined) {
		unlink(sub);
	}
	this.flags = 0 satisfies ReactiveFlags.None;
}
