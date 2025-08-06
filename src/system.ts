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

export enum ReactiveFlags {
	None = 0,
	Mutable = 1 << 0,
	Watching = 1 << 1,
	RecursedCheck = 1 << 2,
	Recursed = 1 << 3,
	Dirty = 1 << 4,
	Pending = 1 << 5,
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
	let currentVersion = 0;
	return {
		link,
		unlink,
		propagate,
		checkDirty,
		endTracking,
		startTracking,
		shallowPropagate,
	};

	function link(dep: ReactiveNode, sub: ReactiveNode): void {
		const prevDep = sub.depsTail;
		if (prevDep !== undefined && prevDep.dep === dep) {
			return;
		}
		const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
		if (nextDep !== undefined && nextDep.dep === dep) {
			nextDep.version = currentVersion;
			sub.depsTail = nextDep;
			return;
		}
		const prevSub = dep.subsTail;
		if (prevSub !== undefined && prevSub.version === currentVersion && prevSub.sub === sub) {
			return;
		}
		const newLink
			= sub.depsTail
			= dep.subsTail
			= {
				version: currentVersion,
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

			if (!(flags & 60 as ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending)) {
				sub.flags = flags | 32 satisfies ReactiveFlags.Pending;
			} else if (!(flags & 12 as ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed)) {
				flags = 0 satisfies ReactiveFlags.None;
			} else if (!(flags & 4 satisfies ReactiveFlags.RecursedCheck)) {
				sub.flags = (flags & ~(8 satisfies ReactiveFlags.Recursed)) | 32 satisfies ReactiveFlags.Pending;
			} else if (!(flags & 48 as ReactiveFlags.Dirty | ReactiveFlags.Pending) && isValidLink(link, sub)) {
				sub.flags = flags | 40 as ReactiveFlags.Recursed | ReactiveFlags.Pending;
				flags &= 1 satisfies ReactiveFlags.Mutable;
			} else {
				flags = 0 satisfies ReactiveFlags.None;
			}

			if (flags & 2 satisfies ReactiveFlags.Watching) {
				notify(sub);
			}

			if (flags & 1 satisfies ReactiveFlags.Mutable) {
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

	function startTracking(sub: ReactiveNode): void {
		++currentVersion;
		sub.depsTail = undefined;
		sub.flags = (sub.flags & ~(56 as ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending)) | 4 satisfies ReactiveFlags.RecursedCheck;
	}

	function endTracking(sub: ReactiveNode): void {
		const depsTail = sub.depsTail;
		let toRemove = depsTail !== undefined ? depsTail.nextDep : sub.deps;
		while (toRemove !== undefined) {
			toRemove = unlink(toRemove, sub);
		}
		sub.flags &= ~(4 satisfies ReactiveFlags.RecursedCheck);
	}

	function checkDirty(link: Link, sub: ReactiveNode): boolean {
		let stack: Stack<Link> | undefined;
		let checkDepth = 0;

		top: do {
			const dep = link.dep;
			const depFlags = dep.flags;

			let dirty = false;

			if (sub.flags & 16 satisfies ReactiveFlags.Dirty) {
				dirty = true;
			} else if ((depFlags & 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty) === 17 as ReactiveFlags.Mutable | ReactiveFlags.Dirty) {
				if (update(dep)) {
					const subs = dep.subs!;
					if (subs.nextSub !== undefined) {
						shallowPropagate(subs);
					}
					dirty = true;
				}
			} else if ((depFlags & 33 as ReactiveFlags.Mutable | ReactiveFlags.Pending) === 33 as ReactiveFlags.Mutable | ReactiveFlags.Pending) {
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

			while (checkDepth) {
				--checkDepth;
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
				} else {
					sub.flags &= ~(32 satisfies ReactiveFlags.Pending);
				}
				sub = link.sub;
				if (link.nextDep !== undefined) {
					link = link.nextDep;
					continue top;
				}
				dirty = false;
			}

			return dirty;
		} while (true);
	}

	function shallowPropagate(link: Link): void {
		do {
			const sub = link.sub;
			const nextSub = link.nextSub;
			const subFlags = sub.flags;
			if ((subFlags & 48 as ReactiveFlags.Pending | ReactiveFlags.Dirty) === 32 satisfies ReactiveFlags.Pending) {
				sub.flags = subFlags | 16 satisfies ReactiveFlags.Dirty;
				if (subFlags & 2 satisfies ReactiveFlags.Watching) {
					notify(sub);
				}
			}
			link = nextSub!;
		} while (link !== undefined);
	}

	function isValidLink(checkLink: Link, sub: ReactiveNode): boolean {
		const depsTail = sub.depsTail;
		if (depsTail !== undefined) {
			let link = sub.deps!;
			do {
				if (link === checkLink) {
					return true;
				}
				if (link === depsTail) {
					break;
				}
				link = link.nextDep!;
			} while (link !== undefined);
		}
		return false;
	}
}
