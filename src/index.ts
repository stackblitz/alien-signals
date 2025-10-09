import { createReactiveSystem, type ReactiveFlags, type ReactiveNode } from './system.js';

interface EffectScope extends ReactiveNode { }

interface Effect extends ReactiveNode {
	fn(): void;
}

interface Computed<T = any> extends ReactiveNode {
	value: T | undefined;
	getter: (previousValue?: T) => T;
}

interface Signal<T = any> extends ReactiveNode {
	currentValue: T;
	pendingValue: T;
}

const queuedEffects: (Effect | EffectScope | undefined)[] = [];
const {
	link,
	unlink,
	propagate,
	checkDirty,
	shallowPropagate,
} = createReactiveSystem({
	update(signal: Signal | Computed): boolean {
		if ('getter' in signal) {
			return updateComputed(signal);
		} else {
			return updateSignal(signal);
		}
	},
	notify,
	unwatched(node: Signal | Computed | Effect | EffectScope) {
		if ('getter' in node) {
			if (node.depsTail !== undefined) {
				node.depsTail = undefined;
				node.flags = 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty;
				purgeDeps(node);
			}
		} else if ('fn' in node) {
			effectOper.call(node);
		} else if (!('currentValue' in node)) {
			effectScopeOper.call(node);
		}
	},
});

let cycle = 0;
let batchDepth = 0;
let notifyIndex = 0;
let queuedEffectsLength = 0;
let activeSub: ReactiveNode | undefined;

export function getActiveSub(): ReactiveNode | undefined {
	return activeSub;
}

export function setActiveSub(sub: ReactiveNode | undefined) {
	const prevSub = activeSub;
	activeSub = sub;
	return prevSub;
}

export function getBatchDepth(): number {
	return batchDepth;
}

export function startBatch() {
	++batchDepth;
}

export function endBatch() {
	if (!--batchDepth) {
		flush();
	}
}

export function isSignal(fn: () => void): boolean {
	return fn.name === 'bound signalOper';
}

export function isComputed(fn: () => void): boolean {
	return fn.name === 'bound computedOper';
}

export function isEffect(fn: () => void): boolean {
	return fn.name === 'bound effectOper';
}

export function isEffectScope(fn: () => void): boolean {
	return fn.name === 'bound effectScopeOper';
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
		currentValue: initialValue,
		pendingValue: initialValue,
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
		flags: 0 satisfies ReactiveFlags.None,
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
	const prevSub = setActiveSub(e);
	if (prevSub !== undefined) {
		link(e, prevSub, 0);
	}
	try {
		e.fn();
	} finally {
		activeSub = prevSub;
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
	const prevSub = setActiveSub(e);
	if (prevSub !== undefined) {
		link(e, prevSub, 0);
	}
	try {
		fn();
	} finally {
		activeSub = prevSub;
	}
	return effectScopeOper.bind(e);
}

function updateComputed(c: Computed): boolean {
	++cycle;
	c.depsTail = undefined;
	c.flags = 5 as (ReactiveFlags.Mutable | ReactiveFlags.RecursedCheck);
	const prevSub = setActiveSub(c);
	try {
		const oldValue = c.value;
		return oldValue !== (c.value = c.getter(oldValue));
	} finally {
		activeSub = prevSub;
		c.flags &= ~(4 satisfies ReactiveFlags.RecursedCheck);
		purgeDeps(c);
	}
}

function updateSignal(s: Signal): boolean {
	s.flags = 1 satisfies ReactiveFlags.Mutable;
	return s.currentValue !== (s.currentValue = s.pendingValue);
}

function notify(e: Effect | EffectScope) {
	const flags = e.flags;
	if (!(flags & 64 /* Queued */)) {
		e.flags = flags | 64 /* Queued */;
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
		|| (
			flags & 32 satisfies ReactiveFlags.Pending
			&& (
				checkDirty(e.deps!, e)
				|| (e.flags = flags & ~(32 satisfies ReactiveFlags.Pending), false)
			)
		)
	) {
		++cycle;
		e.depsTail = undefined;
		e.flags = 6 as (ReactiveFlags.Watching | ReactiveFlags.RecursedCheck);
		const prevSub = setActiveSub(e);
		try {
			(e as Effect).fn();
		} finally {
			activeSub = prevSub;
			e.flags &= ~(4 satisfies ReactiveFlags.RecursedCheck);
			purgeDeps(e);
		}
	} else {
		let link = e.deps;
		while (link !== undefined) {
			const dep = link.dep;
			const depFlags = dep.flags;
			if (depFlags & 64 /* Queued */) {
				run(dep, dep.flags = depFlags & ~(64 /* Queued */));
			}
			link = link.nextDep;
		}
	}
}

function flush(): void {
	while (notifyIndex < queuedEffectsLength) {
		const effect = queuedEffects[notifyIndex]!;
		queuedEffects[notifyIndex++] = undefined;
		run(effect, effect.flags &= ~(64 /* Queued */));
	}
	notifyIndex = 0;
	queuedEffectsLength = 0;
}

function computedOper<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (
		flags & 16 satisfies ReactiveFlags.Dirty
		|| (
			flags & 32 satisfies ReactiveFlags.Pending
			&& (
				checkDirty(this.deps!, this)
				|| (this.flags = flags & ~(32 satisfies ReactiveFlags.Pending), false)
			)
		)
	) {
		if (updateComputed(this)) {
			const subs = this.subs;
			if (subs !== undefined) {
				shallowPropagate(subs);
			}
		}
	} else if (!flags) {
		this.flags = 1 satisfies ReactiveFlags.Mutable;
		const prevSub = setActiveSub(this);
		try {
			this.value = this.getter();
		} finally {
			activeSub = prevSub;
		}
	}
	const sub = activeSub;
	if (sub !== undefined) {
		link(this, sub, cycle);
	}
	return this.value!;
}

function signalOper<T>(this: Signal<T>, ...value: [T]): T | void {
	if (value.length) {
		if (this.pendingValue !== (this.pendingValue = value[0])) {
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
		if (this.flags & 16 satisfies ReactiveFlags.Dirty) {
			if (updateSignal(this)) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		}
		let sub = activeSub;
		while (sub !== undefined) {
			if (sub.flags & 3 as ReactiveFlags.Mutable | ReactiveFlags.Watching) {
				link(this, sub, cycle);
				break;
			}
			sub = sub.subs?.sub;
		}
		return this.currentValue;
	}
}

function effectOper(this: Effect): void {
	effectScopeOper.call(this);
	this.flags = 0 satisfies ReactiveFlags.None;
}

function effectScopeOper(this: EffectScope): void {
	let dep = this.deps;
	while (dep !== undefined) {
		dep = unlink(dep, this);
	}
	const sub = this.subs;
	if (sub !== undefined) {
		unlink(sub);
	}
}

function purgeDeps(sub: ReactiveNode) {
	const depsTail = sub.depsTail;
	let toRemove = depsTail !== undefined ? depsTail.nextDep : sub.deps;
	while (toRemove !== undefined) {
		toRemove = unlink(toRemove, sub);
	}
}
