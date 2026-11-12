// An experimental reimplementation of the public API of `../src/index.ts`,
// built around one rule: a getter or an effect is called again only when a
// value it read during its last call is different now.
//
// - Every link remembers the value that was read through it. A node that may
//   be out of date compares those values in the order they were read, and
//   stops at the first one that differs, so a dependency that went back to
//   what it was, or a computed that came out the same, costs no call.
// - A computed that nobody subscribes to keeps its value and what it read,
//   but its dependencies do not point back at it: it can be collected, and a
//   read brings it up to date by comparing instead of by calling the getter.
//   The price is that such a read walks the dependencies again after any
//   write, related or not.
// - Effects never run inside a write made by another effect or getter; they
//   wait for it to finish, and an effect that changed something it read is
//   run again until that settles.
// - A getter that throws is not called again until a dependency changes;
//   readers get the same error. An effect that throws does not keep the
//   others from running.

export const enum ReactiveFlags {
	None = 0,
	Mutable = 1,
	Watching = 2,
	Running = 4,
	RecursedCheck = 4,
	Recursed = 8,
	Dirty = 16,
	Pending = 32,
	HasChild = 64,
	Detached = 128,
	Queued = 256,
	Scope = 512,
	Computed = 1024,
	Failed = 2048,
}

export interface ReactiveNode {
	flags: number;
	subs: Link | undefined;
	subsTail: Link | undefined;
	deps?: Link | undefined;
	depsTail?: Link | undefined;
	value?: unknown;
}

export interface Link {
	version: number;
	dep: ReactiveNode;
	sub: ReactiveNode;
	seen: unknown;
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	prevDep: Link | undefined;
	nextDep: Link | undefined;
}

// What a computed holds instead of a value while its getter's last run threw.
interface Failure {
	error: unknown;
	value: unknown;
}

interface Stack<T> {
	value: T;
	prev: Stack<T> | undefined;
}

interface SignalNode<T = any> extends ReactiveNode {
	value: T;
}

interface ComputedNode<T = any> extends ReactiveNode {
	value: T | undefined;
	getter: (previousValue?: T) => T;
	epoch: number;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

interface EffectNode extends ReactiveNode {
	fn(): (() => void) | void;
	cleanup: (() => void) | void;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

interface EffectScopeNode extends ReactiveNode {
	deps: Link | undefined;
	depsTail: Link | undefined;
}

let cycle = 0;
let epoch = 0;
let forceEpoch = 0;
let batchDepth = 0;
let notifyIndex = 0;
let queuedLength = 0;
let activeSub: ReactiveNode | undefined;

const queued: (EffectNode | undefined)[] = [];

export function getActiveSub(): ReactiveNode | undefined {
	return activeSub;
}

export function setActiveSub(sub?: ReactiveNode) {
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
		flags: ReactiveFlags.Mutable | ReactiveFlags.Computed | ReactiveFlags.Detached | ReactiveFlags.Dirty,
		epoch: 0,
		getter: getter as (previousValue?: unknown) => unknown,
	}) as () => T;
}

export function effect(fn: () => void | (() => void)): () => void {
	const e: EffectNode = {
		fn,
		cleanup: undefined,
		subs: undefined,
		subsTail: undefined,
		deps: undefined,
		depsTail: undefined,
		flags: ReactiveFlags.Watching | ReactiveFlags.Running,
	};
	const parent = activeSub;
	if (parent !== undefined) {
		link(e, parent, undefined);
		parent.flags |= ReactiveFlags.HasChild;
	}
	activeSub = e;
	++batchDepth;
	try {
		e.cleanup = e.fn();
	} finally {
		activeSub = parent;
		const flags = e.flags;
		if ((flags & (ReactiveFlags.Watching | ReactiveFlags.Pending)) === ReactiveFlags.Watching) {
			e.flags = flags & ~ReactiveFlags.Running;
		} else {
			finish(e, flags);
		}
		if (!--batchDepth && notifyIndex < queuedLength) {
			flush();
		}
	}
	return effectOper.bind(e);
}

export function effectScope(fn: () => void): () => void {
	const e: EffectScopeNode = {
		deps: undefined,
		depsTail: undefined,
		subs: undefined,
		subsTail: undefined,
		flags: ReactiveFlags.Scope | ReactiveFlags.Running,
	};
	const parent = activeSub;
	if (parent !== undefined) {
		link(e, parent, undefined);
		parent.flags |= ReactiveFlags.HasChild;
	}
	activeSub = e;
	try {
		fn();
	} finally {
		activeSub = parent;
		if (e.flags & ReactiveFlags.Scope) {
			e.flags = ReactiveFlags.Scope;
		} else {
			disposeDeps(e);
		}
	}
	return effectScopeOper.bind(e);
}

export function trigger(fn: () => void) {
	// Marked as detached so that reads are recorded on this node only and
	// nothing has to be removed from the dependencies afterwards.
	const sub: EffectScopeNode = {
		deps: undefined,
		depsTail: undefined,
		subs: undefined,
		subsTail: undefined,
		flags: ReactiveFlags.Detached,
	};
	const prevSub = activeSub;
	activeSub = sub;
	++batchDepth;
	try {
		fn();
	} finally {
		activeSub = prevSub;
		// Unwatched computeds are not reachable through subscriber lists, so
		// anything validated before this point is treated as out of date.
		forceEpoch = ++epoch;
		let link = sub.deps;
		while (link !== undefined) {
			const dep = link.dep;
			const next = link.nextDep;
			if (dep.flags & ReactiveFlags.Mutable) {
				let subLink = dep.subs;
				if (subLink !== undefined) {
					propagate(subLink);
					do {
						const flags = subLink.sub.flags;
						if (flags & ReactiveFlags.Pending) {
							subLink.sub.flags = flags | ReactiveFlags.Dirty;
						}
					} while ((subLink = subLink.nextSub) !== undefined);
				}
			} else {
				unlinkSub(link, dep);
			}
			link = next;
		}
		if (!--batchDepth) {
			flush();
		}
	}
}

// Records that `sub` read `value` from `dep`. A subscriber that nobody
// observes (a detached computed) only remembers what it read: the dependency
// does not point back at it, so it is never notified and can be collected.
function link(dep: ReactiveNode, sub: ReactiveNode, value: unknown): void {
	const prevDep = sub.depsTail;
	if (prevDep !== undefined && prevDep.dep === dep) {
		return;
	}
	const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
	if (nextDep !== undefined && nextDep.dep === dep) {
		nextDep.version = cycle;
		nextDep.seen = value;
		sub.depsTail = nextDep;
		return;
	}
	const subFlags = sub.flags;
	let prevSub = dep.subsTail;
	let subscribe = true;
	if (subFlags & (ReactiveFlags.Detached | ReactiveFlags.Scope) && dep.flags & ReactiveFlags.Mutable) {
		if (subFlags & ReactiveFlags.Scope) {
			// A scope only owns effects. What is read directly inside it
			// belongs to whatever the scope itself is running in.
			const parent = sub.subs;
			if (parent !== undefined) {
				link(dep, parent.sub, value);
			}
			return;
		}
		prevSub = undefined;
		subscribe = false;
	} else if (prevSub !== undefined && prevSub.version === cycle && prevSub.sub === sub) {
		return;
	}
	const newLink: Link
		= sub.depsTail
		= {
			version: cycle,
			dep,
			sub,
			seen: value,
			prevDep,
			nextDep,
			prevSub,
			nextSub: undefined,
		};
	if (nextDep !== undefined) {
		nextDep.prevDep = newLink;
	}
	if (prevDep !== undefined) {
		prevDep.nextDep = newLink;
	} else {
		sub.deps = newLink;
	}
	if (subscribe) {
		dep.subsTail = newLink;
		if (prevSub !== undefined) {
			prevSub.nextSub = newLink;
		} else {
			dep.subs = newLink;
			if (dep.flags & ReactiveFlags.Detached) {
				attach(dep as ComputedNode);
			}
		}
	}
}

function unlink(link: Link, sub: ReactiveNode): Link | undefined {
	const dep = link.dep;
	const prevDep = link.prevDep;
	const nextDep = link.nextDep;
	if (nextDep !== undefined) {
		nextDep.prevDep = prevDep;
	} else {
		sub.depsTail = prevDep;
	}
	if (prevDep !== undefined) {
		prevDep.nextDep = nextDep;
	} else {
		sub.deps = nextDep;
	}
	if (!(sub.flags & ReactiveFlags.Detached) || !(dep.flags & ReactiveFlags.Mutable)) {
		unlinkSub(link, dep);
	}
	return nextDep;
}

function unlinkSub(link: Link, dep: ReactiveNode): void {
	const prevSub = link.prevSub;
	const nextSub = link.nextSub;
	if (nextSub !== undefined) {
		nextSub.prevSub = prevSub;
	} else {
		dep.subsTail = prevSub;
	}
	if (prevSub !== undefined) {
		prevSub.nextSub = nextSub;
	} else if ((dep.subs = nextSub) === undefined) {
		const flags = dep.flags;
		if (flags & (ReactiveFlags.Computed | ReactiveFlags.Watching | ReactiveFlags.Scope)) {
			if (flags & ReactiveFlags.Computed) {
				detach(dep as ComputedNode);
			} else if (flags & ReactiveFlags.Watching) {
				effectOper.call(dep as EffectNode);
			} else {
				effectScopeOper.call(dep as EffectScopeNode);
			}
		}
	}
}

// A computed that gains its first subscriber starts receiving invalidations:
// register its dependency links upstream, transitively.
function attach(c: ComputedNode): void {
	let flags = c.flags & ~ReactiveFlags.Detached;
	if (flags & ReactiveFlags.Pending || c.epoch !== epoch) {
		// Possibly out of date, and no subscriber has been told about it yet.
		flags |= ReactiveFlags.Pending | ReactiveFlags.Recursed;
	}
	c.flags = flags;
	for (let link = c.deps; link !== undefined; link = link.nextDep) {
		const dep = link.dep;
		if (dep.flags & ReactiveFlags.Mutable) {
			const prevSub = dep.subsTail;
			link.prevSub = prevSub;
			link.nextSub = undefined;
			dep.subsTail = link;
			if (prevSub !== undefined) {
				prevSub.nextSub = link;
			} else {
				dep.subs = link;
				if (dep.flags & ReactiveFlags.Detached) {
					attach(dep as ComputedNode);
				}
			}
		}
	}
}

// A computed that lost its last subscriber stops receiving invalidations but
// keeps its value and the values it read, so a later read can still be
// answered without calling the getter when nothing it read has changed.
function detach(c: ComputedNode): void {
	const flags = c.flags;
	if (flags & ReactiveFlags.HasChild) {
		// Effects created by the getter must not outlive the last observer.
		if (flags & ReactiveFlags.Failed) {
			c.value = (c.value as Failure).value;
		}
		c.flags = ReactiveFlags.Mutable | ReactiveFlags.Computed | ReactiveFlags.Dirty;
		try {
			disposeDeps(c);
		} finally {
			c.flags |= ReactiveFlags.Detached;
		}
		return;
	}
	c.flags = (flags & ~ReactiveFlags.Recursed) | ReactiveFlags.Detached;
	c.epoch = epoch;
	for (let link = c.deps; link !== undefined; link = link.nextDep) {
		const dep = link.dep;
		if (dep.flags & ReactiveFlags.Mutable) {
			unlinkSub(link, dep);
		}
	}
}

function propagate(link: Link): void {
	let next = link.nextSub;
	let stack: Stack<Link | undefined> | undefined;

	top: do {
		const sub = link.sub;
		const flags = sub.flags;

		sibling: {
			if (!(flags & (ReactiveFlags.Running | ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending))) {
				sub.flags = flags | ReactiveFlags.Pending;
			} else if (!(flags & (ReactiveFlags.Running | ReactiveFlags.Recursed))) {
				break sibling;
			} else if (flags & ReactiveFlags.Running) {
				// It decides after its run whether what it read is still current.
				sub.flags = flags | (ReactiveFlags.Pending | ReactiveFlags.Recursed);
				break sibling;
			} else {
				sub.flags = (flags & ~ReactiveFlags.Recursed) | ReactiveFlags.Pending;
			}
			if (flags & ReactiveFlags.Watching) {
				if (!(flags & ReactiveFlags.Queued)) {
					notify(sub as EffectNode);
				}
				break sibling;
			}
			const subSubs = sub.subs;
			if (subSubs !== undefined) {
				const nextSub = (link = subSubs).nextSub;
				if (nextSub !== undefined) {
					stack = { value: next, prev: stack };
					next = nextSub;
				}
				continue;
			}
		}

		if (next !== undefined) {
			next = (link = next).nextSub;
			continue;
		}

		while (stack !== undefined) {
			const value = stack.value;
			stack = stack.prev;
			if (value !== undefined) {
				next = (link = value).nextSub;
				continue top;
			}
		}

		break;
	} while (true);
}

function notify(e: EffectNode): void {
	let insertIndex = queuedLength;
	let firstInsertedIndex = insertIndex;

	do {
		queued[insertIndex++] = e;
		e.flags |= ReactiveFlags.Queued;
		e = e.subs?.sub as EffectNode;
		if (e === undefined || (e.flags & (ReactiveFlags.Watching | ReactiveFlags.Queued)) !== ReactiveFlags.Watching) {
			break;
		}
	} while (true);

	queuedLength = insertIndex;

	while (firstInsertedIndex < --insertIndex) {
		const left = queued[firstInsertedIndex];
		queued[firstInsertedIndex++] = queued[insertIndex];
		queued[insertIndex] = left;
	}
}

// Decides whether `sub` must re-run by comparing, in read order, the value it
// last read from each dependency with that dependency's current value.
// Dependencies that may themselves be out of date are brought up to date first.
function checkDirty(link: Link, sub: ReactiveNode): boolean {
	const startEpoch = epoch;
	let stack: Stack<Link> | undefined;
	let checkDepth = 0;
	let dirty = false;

	top: do {
		const dep = link.dep;
		const flags = dep.flags;

		compare: {
			if (
				flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending | ReactiveFlags.Detached | ReactiveFlags.Running)
				&& flags & ReactiveFlags.Mutable
			) {
				if (flags & ReactiveFlags.Running) {
					// Whoever asked for this check is being evaluated on behalf
					// of `dep`, which in turn is one of the things to check.
					// Reading it again is what reports the cycle.
					dirty = true;
					break compare;
				}
				if (flags & ReactiveFlags.Dirty || (flags & ReactiveFlags.Detached && (dep as ComputedNode).epoch < forceEpoch)) {
					updateComputed(dep as ComputedNode);
				} else if (flags & ReactiveFlags.Pending || (dep as ComputedNode).epoch !== epoch) {
					const depDeps = dep.deps;
					if (depDeps !== undefined) {
						stack = { value: link, prev: stack };
						link = depDeps;
						sub = dep;
						++checkDepth;
						continue;
					}
					dep.flags = flags & ~(ReactiveFlags.Pending | ReactiveFlags.Recursed);
					(dep as ComputedNode).epoch = epoch;
				}
			}
			dirty = dep.value !== link.seen;
		}

		if (!dirty) {
			const nextDep = link.nextDep;
			if (nextDep !== undefined) {
				link = nextDep;
				continue;
			}
		}

		while (checkDepth--) {
			link = stack!.value;
			stack = stack!.prev;
			// A write made while the dependencies were being checked may have
			// touched one that was already compared, so recompute to be safe.
			if (dirty || epoch !== startEpoch) {
				updateComputed(sub as ComputedNode);
			} else {
				const subFlags = sub.flags;
				sub.flags = subFlags & ~(ReactiveFlags.Pending | ReactiveFlags.Recursed);
				if (subFlags & ReactiveFlags.Detached) {
					(sub as ComputedNode).epoch = epoch;
				}
			}
			dirty = sub.value !== link.seen;
			sub = link.sub;
			if (!dirty) {
				const nextDep = link.nextDep;
				if (nextDep !== undefined) {
					link = nextDep;
					continue top;
				}
			}
		}

		return dirty;
	} while (true);
}

// A getter that throws leaves a failure in place of the value. It compares
// unequal to everything read from the computed before, and is handed to
// readers as the error it holds until a dependency changes.
function updateComputed(c: ComputedNode): boolean {
	const flags = c.flags;
	const prevValue = flags & ReactiveFlags.Failed ? (c.value as Failure).value : c.value;
	if (flags & ReactiveFlags.HasChild) {
		try {
			disposeChildren(c);
		} catch (error) {
			c.value = { error, value: prevValue } satisfies Failure;
			c.flags = flags | (ReactiveFlags.Dirty | ReactiveFlags.Failed);
			return true;
		}
	}
	c.depsTail = undefined;
	c.flags = (flags & (ReactiveFlags.Mutable | ReactiveFlags.Computed | ReactiveFlags.Detached)) | ReactiveFlags.Running;
	if (flags & ReactiveFlags.Detached) {
		c.epoch = epoch;
	}
	const prevSub = activeSub;
	activeSub = c;
	++cycle;
	let failed = false;
	try {
		c.value = c.getter(prevValue);
	} catch (error) {
		c.value = { error, value: prevValue } satisfies Failure;
		c.flags |= ReactiveFlags.Failed;
		failed = true;
	}
	activeSub = prevSub;
	c.flags &= ~ReactiveFlags.Running;
	const depsTail = c.depsTail as Link | undefined;
	let dep = depsTail !== undefined ? depsTail.nextDep : c.deps;
	while (dep !== undefined) {
		dep = unlink(dep, c);
	}
	return failed;
}

// Brings a computed that may be out of date up to date, and throws what its
// getter threw if that is how it ended.
function pull(c: ComputedNode, flags: number): void {
	if (flags & ReactiveFlags.Running) {
		throwCycle();
	}
	if (flags & ReactiveFlags.Dirty || (flags & ReactiveFlags.Detached && c.epoch < forceEpoch)) {
		const sub = activeSub;
		if (
			c.deps === undefined
			&& sub !== undefined
			&& flags & ReactiveFlags.Detached
			&& !(sub.flags & (ReactiveFlags.Detached | ReactiveFlags.Scope))
		) {
			// First evaluation, on behalf of a subscriber that is about to
			// subscribe: subscribe to the dependencies as they are read
			// instead of in a second pass afterwards.
			c.flags = flags & ~ReactiveFlags.Detached;
		}
		if (updateComputed(c)) {
			rethrow(c);
		}
	} else {
		const startEpoch = epoch;
		const deps = c.deps;
		if ((deps !== undefined && checkDirty(deps, c)) || epoch !== startEpoch) {
			if (updateComputed(c)) {
				rethrow(c);
			}
		} else {
			// Read again: getters that ran during the check may have marked it.
			c.flags = flags = c.flags & ~(ReactiveFlags.Pending | ReactiveFlags.Recursed);
			c.epoch = epoch;
			if (flags & ReactiveFlags.Failed) {
				rethrow(c);
			}
		}
	}
}

function rethrow(c: ComputedNode): never {
	const sub = activeSub;
	if (sub !== undefined) {
		link(c, sub, c.value);
	}
	throw (c.value as Failure).error;
}

// Same, for a read made outside of any batch: effects scheduled by writes
// made from inside getters wait until the computed has its new value.
function pullAndFlush(c: ComputedNode, flags: number): void {
	++batchDepth;
	try {
		pull(c, flags);
	} finally {
		if (!--batchDepth && notifyIndex < queuedLength) {
			flush();
		}
	}
}

function run(e: EffectNode): void {
	const flags = e.flags;
	if (!(flags & ReactiveFlags.Dirty)) {
		if (!(flags & ReactiveFlags.Pending)) {
			e.flags = flags & ~ReactiveFlags.Queued;
			return;
		}
		let dirty = false;
		let link = e.deps;
		while (link !== undefined) {
			const dep = link.dep;
			if (dep.flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending | ReactiveFlags.Detached)) {
				// Getters may run from here on. The effect counts as running
				// meanwhile, so a write made by one of them is recorded.
				e.flags = (flags & ~ReactiveFlags.Pending) | ReactiveFlags.Running;
				dirty = checkDirty(link, e);
				const current = e.flags;
				if (!(current & ReactiveFlags.Watching)) {
					e.flags = ReactiveFlags.None;
					disposeDeps(e);
					return;
				}
				if (!dirty) {
					e.flags = current & ~(ReactiveFlags.Queued | ReactiveFlags.Running | ReactiveFlags.Recursed);
					if (current & ReactiveFlags.Pending) {
						notify(e);
					}
					return;
				}
				e.flags = current & ~ReactiveFlags.Running;
				break;
			}
			if (dep.value !== link.seen) {
				dirty = true;
				break;
			}
			link = link.nextDep;
		}
		if (!dirty) {
			e.flags = flags & ~(ReactiveFlags.Queued | ReactiveFlags.Pending);
			return;
		}
	}
	if ((flags & ReactiveFlags.HasChild || e.cleanup) && !reset(e)) {
		return;
	}
	e.depsTail = undefined;
	e.flags = ReactiveFlags.Watching | ReactiveFlags.Running;
	const prevSub = activeSub;
	activeSub = e;
	++cycle;
	try {
		e.cleanup = e.fn();
	} finally {
		activeSub = prevSub;
		const current = e.flags;
		if ((current & (ReactiveFlags.Watching | ReactiveFlags.Pending)) === ReactiveFlags.Watching) {
			e.flags = current & ~ReactiveFlags.Running;
		} else {
			finish(e, current);
		}
		const depsTail = e.depsTail as Link | undefined;
		let dep = depsTail !== undefined ? depsTail.nextDep : e.deps;
		while (dep !== undefined) {
			dep = unlink(dep, e);
		}
	}
}

// Undoes what the previous run of an effect left behind. Returns whether the
// effect is still there afterwards.
function reset(e: EffectNode): boolean {
	if (e.flags & ReactiveFlags.HasChild) {
		try {
			disposeChildren(e);
		} catch (err) {
			// The children are gone all the same. Come back for the run.
			if (e.flags & ReactiveFlags.Watching) {
				e.flags |= ReactiveFlags.Dirty;
				queued[queuedLength++] = e;
			}
			throw err;
		}
	}
	if (e.cleanup) {
		try {
			runCleanup(e);
		} catch (err) {
			effectScopeOper.call(e);
			throw err;
		}
	}
	return (e.flags & ReactiveFlags.Watching) !== 0;
}

// The uncommon ways for an effect run to end.
function finish(e: EffectNode, flags: number): void {
	if (flags & ReactiveFlags.Watching) {
		// Something it read changed during the run: check it again.
		e.flags = flags & ~(ReactiveFlags.Running | ReactiveFlags.Recursed);
		if (!(flags & ReactiveFlags.Queued)) {
			notify(e);
		}
	} else {
		// Disposed while it was running. It may not have read all of its
		// previous dependencies again, and those go as well.
		e.flags = ReactiveFlags.None;
		let tail = e.depsTail ?? e.deps;
		if (tail !== undefined) {
			while (tail.nextDep !== undefined) {
				tail = tail.nextDep;
			}
			e.depsTail = tail;
		}
		try {
			disposeDeps(e);
		} finally {
			if (e.cleanup) {
				runCleanup(e);
			}
		}
	}
}

function flush(): void {
	let rounds = 0;
	let roundEnd = queuedLength;
	let failure = false;
	let error: unknown;
	++batchDepth;
	while (notifyIndex < queuedLength) {
		if (notifyIndex === roundEnd) {
			// Everything queued when the previous round started has run,
			// and running it queued more. Effects that keep invalidating
			// each other never settle, so give up at some point.
			if (++rounds > 100_000) {
				do {
					const e = queued[notifyIndex]!;
					queued[notifyIndex++] = undefined;
					const flags = e.flags & ~ReactiveFlags.Queued;
					e.flags = flags & ReactiveFlags.Pending ? flags | ReactiveFlags.Recursed : flags;
				} while (notifyIndex < queuedLength);
				failure = true;
				error = new Error('Cycle detected');
				break;
			}
			roundEnd = queuedLength;
		}
		const e = queued[notifyIndex]!;
		queued[notifyIndex++] = undefined;
		try {
			run(e);
		} catch (err) {
			// One effect failing does not keep the others from running.
			if (!failure) {
				failure = true;
				error = err;
			}
		}
	}
	notifyIndex = 0;
	queuedLength = 0;
	--batchDepth;
	if (failure) {
		throw error;
	}
}

function throwCycle(): never {
	throw new Error('Cycle detected');
}

function computedOper<T>(this: ComputedNode<T>): T {
	const flags = this.flags;
	if (flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending | ReactiveFlags.Detached | ReactiveFlags.Running | ReactiveFlags.Failed)) {
		if (flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending | ReactiveFlags.Running) || this.epoch !== epoch) {
			if (batchDepth) {
				pull(this, flags);
			} else {
				pullAndFlush(this, flags);
			}
		} else if (flags & ReactiveFlags.Failed) {
			rethrow(this);
		}
	}
	const sub = activeSub;
	if (sub !== undefined) {
		link(this, sub, this.value);
	}
	return this.value!;
}

function signalOper<T>(this: SignalNode<T>, ...value: [T]): T | void {
	if (value.length) {
		if (this.value !== (this.value = value[0])) {
			++epoch;
			const subs = this.subs;
			if (subs !== undefined) {
				propagate(subs);
				if (!batchDepth) {
					flush();
				}
			}
		}
	} else {
		const sub = activeSub;
		if (sub !== undefined) {
			link(this, sub, this.value);
		}
		return this.value;
	}
}

function runCleanup(e: EffectNode): void {
	const cleanup = e.cleanup!;
	e.cleanup = undefined;
	const prevSub = activeSub;
	activeSub = undefined;
	try {
		cleanup();
	} finally {
		activeSub = prevSub;
	}
}

function effectOper(this: EffectNode): void {
	try {
		effectScopeOper.call(this);
	} finally {
		if (this.cleanup) {
			runCleanup(this);
		}
	}
}

function effectScopeOper(this: EffectScopeNode): void {
	const flags = this.flags;
	this.flags = ReactiveFlags.None;
	const sub = this.subs;
	if (sub !== undefined) {
		unlink(sub, sub.sub);
	}
	// A node that is still running gives up its dependencies when it finishes.
	if (!(flags & ReactiveFlags.Running)) {
		disposeDeps(this);
	}
}

function disposeDeps(sub: ReactiveNode): void {
	try {
		let link: Link | undefined;
		while ((link = sub.depsTail) !== undefined) {
			unlink(link, sub);
		}
	} finally {
		// A cleanup that throws must not keep the rest from being released.
		if (sub.depsTail !== undefined) {
			disposeDeps(sub);
		}
	}
}

function disposeChildren(sub: ReactiveNode): void {
	let link = sub.depsTail;
	try {
		while (link !== undefined) {
			const prev = link.prevDep;
			const dep = link.dep;
			link = prev;
			// A child disposed by an earlier cleanup has already removed its link.
			if (!(dep.flags & ReactiveFlags.Mutable) && dep.subs !== undefined) {
				unlink(dep.subs, sub);
			}
		}
	} finally {
		if (link !== undefined) {
			disposeChildren(sub);
		}
	}
}
