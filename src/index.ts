import { Flags } from './flags.js';
import { createReactiveSystem, type ReactiveNode } from './system.js';

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

let cycle = 0;
let batchDepth = 0;
let notifyIndex = 0;
let queuedLength = 0;
let activeSub: ReactiveNode | undefined;

const queued: (Effect | undefined)[] = [];
const {
	link,
	unlink,
	propagate,
	checkDirty,
	shallowPropagate,
} = createReactiveSystem({
	update(node: Signal | Computed): boolean {
		if (node.depsTail !== undefined) {
			return updateComputed(node as Computed);
		} else {
			return updateSignal(node as Signal);
		}
	},
	notify(effect: Effect) {
		let insertIndex = queuedLength;
		let firstInsertedIndex = insertIndex;

		do {
			effect.flags &= ~Flags.Watching;
			queued[insertIndex++] = effect;
			effect = effect.subs?.sub as Effect;
			if (effect === undefined || !(effect.flags & Flags.Watching)) {
				break;
			}
		} while (true);

		queuedLength = insertIndex;

		while (firstInsertedIndex < --insertIndex) {
			const left = queued[firstInsertedIndex];
			queued[firstInsertedIndex++] = queued[insertIndex];
			queued[insertIndex] = left;
		}
	},
	unwatched(node) {
		if (!(node.flags & Flags.Mutable)) {
			effectScopeOper.call(node);
		} else if (node.depsTail !== undefined) {
			node.depsTail = undefined;
			node.flags = Flags.Mutable | Flags.Dirty;
			purgeDeps(node);
		}
	},
});

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
	return fn.name === 'bound ' + signalOper.name;
}

export function isComputed(fn: () => void): boolean {
	return fn.name === 'bound ' + computedOper.name;
}

export function isEffect(fn: () => void): boolean {
	return fn.name === 'bound ' + effectOper.name;
}

export function isEffectScope(fn: () => void): boolean {
	return fn.name === 'bound ' + effectScopeOper.name;
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
		flags: Flags.Mutable,
	}) as () => T | undefined;
}

export function computed<T>(getter: (previousValue?: T) => T): () => T {
	return computedOper.bind({
		value: undefined,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: Flags.None,
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
		flags: Flags.Watching,
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
	const e: ReactiveNode = {
		deps: undefined,
		depsTail: undefined,
		subs: undefined,
		subsTail: undefined,
		flags: Flags.None,
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
	c.flags = Flags.Mutable | Flags.RecursedCheck;
	const prevSub = setActiveSub(c);
	try {
		const oldValue = c.value;
		return oldValue !== (c.value = c.getter(oldValue));
	} finally {
		activeSub = prevSub;
		c.flags &= ~Flags.RecursedCheck;
		purgeDeps(c);
	}
}

function updateSignal(s: Signal): boolean {
	s.flags = Flags.Mutable;
	return s.currentValue !== (s.currentValue = s.pendingValue);
}

function run(e: Effect): void {
	const flags = e.flags;
	if (
		flags & Flags.Dirty
		|| (
			flags & Flags.Pending
			&& checkDirty(e.deps!, e)
		)
	) {
		++cycle;
		e.depsTail = undefined;
		e.flags = Flags.Watching | Flags.RecursedCheck;
		const prevSub = setActiveSub(e);
		try {
			(e as Effect).fn();
		} finally {
			activeSub = prevSub;
			e.flags &= ~Flags.RecursedCheck;
			purgeDeps(e);
		}
	} else {
		e.flags = Flags.Watching;
	}
}

function flush(): void {
	while (notifyIndex < queuedLength) {
		const effect = queued[notifyIndex]!;
		queued[notifyIndex++] = undefined;
		run(effect);
	}
	notifyIndex = 0;
	queuedLength = 0;
}

function computedOper<T>(this: Computed<T>): T {
	const flags = this.flags;
	if (
		flags & Flags.Dirty
		|| (
			flags & Flags.Pending
			&& (
				checkDirty(this.deps!, this)
				|| (this.flags = flags & ~Flags.Pending, false)
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
		this.flags = Flags.Mutable;
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
			this.flags = Flags.Mutable | Flags.Dirty;
			const subs = this.subs;
			if (subs !== undefined) {
				propagate(subs);
				if (!batchDepth) {
					flush();
				}
			}
		}
	} else {
		if (this.flags & Flags.Dirty) {
			if (updateSignal(this)) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		}
		let sub = activeSub;
		while (sub !== undefined) {
			if (sub.flags & (Flags.Mutable | Flags.Watching)) {
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
}

function effectScopeOper(this: ReactiveNode): void {
	this.depsTail = undefined;
	this.flags = Flags.None;
	purgeDeps(this);
	const sub = this.subs;
	if (sub !== undefined) {
		unlink(sub);
	}
}

function purgeDeps(sub: ReactiveNode) {
	const depsTail = sub.depsTail;
	let dep = depsTail !== undefined ? depsTail.nextDep : sub.deps;
	while (dep !== undefined) {
		dep = unlink(dep, sub);
	}
}
