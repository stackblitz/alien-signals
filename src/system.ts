import { ReactiveFlags as Flags } from './flags.js';

export interface ReactiveNode {
	deps?: Link;
	depsTail?: Link;
	subs?: Link;
	subsTail?: Link;
	flags: ReactiveFlags;
}

export interface Link {
	version: number;
	dep: ReactiveNode;
	sub: ReactiveNode;
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	prevDep: Link | undefined;
	nextDep: Link | undefined;
}

interface Stack<T> {
	value: T;
	prev: Stack<T> | undefined;
}

// export js runtime object
export const ReactiveFlags = {
	None: Flags.None,
	Mutable: Flags.Mutable,
	Watching: Flags.Watching,
	RecursedCheck: Flags.RecursedCheck,
	Recursed: Flags.Recursed,
	Dirty: Flags.Dirty,
	Pending: Flags.Pending,
} as const satisfies Record<keyof typeof Flags, Flags>;

// export overrided type (for backward compatibility)
export type ReactiveFlags = Flags;

// export namespace for supporting satisfies (for backward compatibility)
export namespace ReactiveFlags {
  export type None = Flags.None;
  export type Mutable = Flags.Mutable;
  export type Watching = Flags.Watching;
  export type RecursedCheck = Flags.RecursedCheck;
  export type Recursed = Flags.Recursed;
  export type Dirty = Flags.Dirty;
  export type Pending = Flags.Pending;
}

export function createReactiveSystem({
	update,
	notify,
	unwatched,
}: {
	update(sub: ReactiveNode): boolean;
	notify(sub: ReactiveNode): void;
	unwatched(sub: ReactiveNode): void;
}) {
	return {
		link,
		unlink,
		propagate,
		checkDirty,
		shallowPropagate,
	};

	function link(dep: ReactiveNode, sub: ReactiveNode, version: number): void {
		const prevDep = sub.depsTail;
		if (prevDep !== undefined && prevDep.dep === dep) {
			return;
		}
		const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
		if (nextDep !== undefined && nextDep.dep === dep) {
			nextDep.version = version;
			sub.depsTail = nextDep;
			return;
		}
		const prevSub = dep.subsTail;
		if (prevSub !== undefined && prevSub.version === version && prevSub.sub === sub) {
			return;
		}
		const newLink
			= sub.depsTail
			= dep.subsTail
			= {
				version,
				dep,
				sub,
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
		if (prevSub !== undefined) {
			prevSub.nextSub = newLink;
		} else {
			dep.subs = newLink;
		}
	}

	function unlink(link: Link, sub = link.sub): Link | undefined {
		const dep = link.dep;
		const prevDep = link.prevDep;
		const nextDep = link.nextDep;
		const nextSub = link.nextSub;
		const prevSub = link.prevSub;
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
		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
		} else {
			dep.subsTail = prevSub;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		} else if ((dep.subs = nextSub) === undefined) {
			unwatched(dep);
		}
		return nextDep;
	}

	function propagate(link: Link): void {
		let next = link.nextSub;
		let stack: Stack<Link | undefined> | undefined;

		top: do {
			const sub = link.sub;
			let flags = sub.flags;

			if (!(flags & (Flags.RecursedCheck | Flags.Recursed | Flags.Dirty | Flags.Pending))) {
				sub.flags = flags | Flags.Pending;
			} else if (!(flags & (Flags.RecursedCheck | Flags.Recursed))) {
				flags = Flags.None;
			} else if (!(flags & Flags.RecursedCheck)) {
				sub.flags = (flags & ~Flags.Recursed) | Flags.Pending;
			} else if (!(flags & (Flags.Dirty | Flags.Pending)) && isValidLink(link, sub)) {
				sub.flags = flags | (Flags.Recursed | Flags.Pending);
				flags &= Flags.Mutable;
			} else {
				flags = Flags.None;
			}

			if (flags & Flags.Watching) {
				notify(sub);
			}

			if (flags & Flags.Mutable) {
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

			if ((link = next!) !== undefined) {
				next = link.nextSub;
				continue;
			}

			while (stack !== undefined) {
				link = stack.value!;
				stack = stack.prev;
				if (link !== undefined) {
					next = link.nextSub;
					continue top;
				}
			}

			break;
		} while (true);
	}

	function checkDirty(link: Link, sub: ReactiveNode): boolean {
		let stack: Stack<Link> | undefined;
		let checkDepth = 0;
		let dirty = false;

		top: do {
			const dep = link.dep;
			const flags = dep.flags;

			if (sub.flags & Flags.Dirty) {
				dirty = true;
			} else if ((flags & (Flags.Mutable | Flags.Dirty)) === (Flags.Mutable | Flags.Dirty)) {
				if (update(dep)) {
					const subs = dep.subs!;
					if (subs.nextSub !== undefined) {
						shallowPropagate(subs);
					}
					dirty = true;
				}
			} else if ((flags & (Flags.Mutable | Flags.Pending)) === (Flags.Mutable | Flags.Pending)) {
				if (link.nextSub !== undefined || link.prevSub !== undefined) {
					stack = { value: link, prev: stack };
				}
				link = dep.deps!;
				sub = dep;
				++checkDepth;
				continue;
			}

			if (!dirty) {
				const nextDep = link.nextDep;
				if (nextDep !== undefined) {
					link = nextDep;
					continue;
				}
			}

			while (checkDepth--) {
				const firstSub = sub.subs!;
				const hasMultipleSubs = firstSub.nextSub !== undefined;
				if (hasMultipleSubs) {
					link = stack!.value;
					stack = stack!.prev;
				} else {
					link = firstSub;
				}
				if (dirty) {
					if (update(sub)) {
						if (hasMultipleSubs) {
							shallowPropagate(firstSub);
						}
						sub = link.sub;
						continue;
					}
					dirty = false;
				} else {
					sub.flags &= ~Flags.Pending;
				}
				sub = link.sub;
				const nextDep = link.nextDep;
				if (nextDep !== undefined) {
					link = nextDep;
					continue top;
				}
			}

			return dirty;
		} while (true);
	}

	function shallowPropagate(link: Link): void {
		do {
			const sub = link.sub;
			const flags = sub.flags;
			if ((flags & (Flags.Pending | Flags.Dirty)) === Flags.Pending) {
				sub.flags = flags | Flags.Dirty;
				if (flags & Flags.Watching) {
					notify(sub);
				}
			}
		} while ((link = link.nextSub!) !== undefined);
	}

	function isValidLink(checkLink: Link, sub: ReactiveNode): boolean {
		let link = sub.depsTail;
		while (link !== undefined) {
			if (link === checkLink) {
				return true;
			}
			link = link.prevDep;
		}
		return false;
	}
}
