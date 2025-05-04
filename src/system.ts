export interface ReactiveNode {
	/**
	 * Linked list of dependencies - when they change, this node need to re-run.
	 * ```ts
	 * const data = signal(1);
	 * const timesTwo = computed(() => data() * 2);
	 * timesTwo();
	 * // timesTwo.deps -> data
	 * // data.subs -> timesTwo
	 * ```
	 */
	deps?: Link;
	depsTail?: Link;
	/** Linked list of subscribers - when this node changes, notify them. */
	subs?: Link;
	subsTail?: Link;
	flags: ReactiveFlags;
}

export interface Link {
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

export const enum ReactiveFlags {
	None = 0,
	/**
	 * When the ReactiveNode is used as a dependency, its value is mutable, so
	 * propagate needs to set Pending/Dirty for it, and checkDirty needs to
	 * trigger an update for it.
	 */
	Mutable = 1 << 0,
	/** A Watching node will have `notify(node)` called on it when its deps change. */
	Watching = 1 << 1,
	/**
	 * RecursedCheck, Recursed: During the run of an effect/computed, if other
	 * signal values ​​are changed, which indirectly or directly causes the
	 * effect/computed to be set to Pending/Dirty during the run, it needs to be
	 * recorded as Recursed to avoid failures. It aims to solve such edge cases:
	 * https://github.com/proposal-signals/signal-polyfill/pull/44/files#diff-11c8a943a1bcaf1e91e4bbcd27a589556340630ae5bb31f57884c8ef584b9fa5
	 */
	RecursedCheck = 1 << 2,
	Recursed = 1 << 3,
	/* A Dirty node is known to need to re-run. */
	Dirty = 1 << 4,
	/** A Pending node may need to re-run. */
	Pending = 1 << 5,
}

/**
 * Create a reactive system that propagates dirty notifications from
 * dependencies to subscribers.
 */
export function createReactiveSystem({
	update,
	notify,
	unwatched,
}: {
	/**
	 * A `sub`, which is used as a dependency, is dirty and needs to be re-run.
	 * `update` should re-run it, and return `true` if `sub` changed -- meaning
	 * the system should propagate dirty to `sub`'s subs.
	 */
	update(sub: ReactiveNode): boolean;
	/**
	 * One of `sub`'s deps (including indirect ones) may have changed.
	 * `notify(sub)` should schedule a check if `sub` is dirty, and if so, re-run it.
	 */
	notify(sub: ReactiveNode): void;
	/**
	 * `sub` no longer has any subscribers.
	 * `unwatched(sub)` should remove `sub` from its deps, and perform any cleanup
	 * necessary, like freeing memory.
	 */
	unwatched(sub: ReactiveNode): void;
}) {
	return {
		link,
		unlink,
		propagate,
		checkDirty,
		endTracking,
		startTracking,
		shallowPropagate,
	};

	/**
	 * Link a dependency to a subscriber.
	 * 
	 * ```ts
	 * const data = signal(1);
	 * const timesTwo = computed(() => data() * 2);
	 * timesTwo();
	 * // link(data, timesTwo);
	 * // data.subs -> timesTwo
	 * // timesTwo.deps -> data
	 * ```
	 */
	function link(dep: ReactiveNode, sub: ReactiveNode): void {
		const prevDep = sub.depsTail;
		if (prevDep !== undefined && prevDep.dep === dep) {
			return;
		}
		let nextDep: Link | undefined = undefined;
		const recursedCheck = sub.flags & ReactiveFlags.RecursedCheck;
		if (recursedCheck) {
			nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
			if (nextDep !== undefined && nextDep.dep === dep) {
				sub.depsTail = nextDep;
				return;
			}
		}
		const prevSub = dep.subsTail;
		if (
			prevSub !== undefined
			&& prevSub.sub === sub
			&& (!recursedCheck || isValidLink(prevSub, sub))
		) {
			return;
		}
		const newLink
			= sub.depsTail
			= dep.subsTail
			= {
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

	/**
	 * Remove a link.
	 * Updates the dep list head/tail in `sub`.
	 * @returns `link.nextDep`, the rest of the linked list.
	 */
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

	/**
	 * Notify all direct and indirect subscribers of a node that they
	 * *may* be dirty (Pending) and should be checked.
	 */
	function propagate(link: Link): void {
		let next = link.nextSub;
		let stack: Stack<Link | undefined> | undefined;

		// This implementation avoids recursion by using an explicit stack.
		// See README.md for the easier-to-understand recursive version.
		top: do {
			const sub = link.sub;

			let flags = sub.flags;

			if (flags & (ReactiveFlags.Mutable | ReactiveFlags.Watching)) {
				if (!(flags & (ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending))) {
					/**
					 * @when Running ❌, Recursed ❌, Dirty ❌
					 * @then Notify ✅, Propagate ✅
					 */
					sub.flags = flags | ReactiveFlags.Pending;
				} else if (!(flags & (ReactiveFlags.RecursedCheck | ReactiveFlags.Recursed))) {
					/**
					 * @when Running ❌, Recursed ❌, Dirty ✅
					 * @then Notify ❌, Propagate ❌
					 */
					flags = ReactiveFlags.None;
				} else if (!(flags & ReactiveFlags.RecursedCheck)) {
					/**
					 * @when Running ❌, Recursed ✅, Dirty ✅
					 * @then Notify ✅, Propagate ✅
					 */
					sub.flags = (flags & ~ReactiveFlags.Recursed) | ReactiveFlags.Pending;
				} else if (isValidLink(link, sub)) {
					if (!(flags & (ReactiveFlags.Dirty | ReactiveFlags.Pending))) {
						/**
						 * @when Running ✅, Dirty ❌
						 * @then Notify ❌, Propagate ✅
						 */
						sub.flags = flags | ReactiveFlags.Recursed | ReactiveFlags.Pending;
						flags &= ReactiveFlags.Mutable;
					} else {
						/**
						 * @when Running ✅, Dirty ✅
						 * @then Notify ❌, Propagate ❌
						 */
						flags = ReactiveFlags.None;
					}
				} else {
					flags = ReactiveFlags.None;
				}

				if (flags & ReactiveFlags.Watching) {
					notify(sub);
				}

				if (flags & ReactiveFlags.Mutable) {
					const subSubs = sub.subs;
					if (subSubs !== undefined) {
						link = subSubs;
						if (subSubs.nextSub !== undefined) {
							stack = { value: next, prev: stack };
							next = link.nextSub;
						}
						continue;
					}
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

	/**
	 * `startTracking(sub)` prepares to re-write `sub`'s deps while `sub` is
	 * running. (This does not modify any global state.)
	 * 
	 * In order to collect dynamic dependencies correctly, in theory we should
	 * clear the current deps when startingTracking, so that the dependencies
	 * collected during effect/computed re-run are new and reflect the latest
	 * run only.
	 * 
	 * ```ts
	 * function startTracking(sub: ReactiveNode): void {
	 *   let dep = sub.deps;
	 *   while (dep !== undefined) {
	 *     dep = unlink(dep, sub);
	 *   }
	 *   sub.flags = (sub.flags & ~(ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending)) | ReactiveFlags.RecursedCheck;
	 * }
	 * 
	 * function endTracking(sub: ReactiveNode): void {
	 *   sub.flags &= ~ReactiveFlags.RecursedCheck;
	 * }
	 * ```
	 * 
	 * But this doesn't perform well. `depsTail = undefined` is a optimization
	 * method for this problem, during re-run it will compare deps one by one to
	 * see if it is the same as before. If so, it only needs to update depsTail n
	 * times. Finally, endTracking will prune deps that are no longer used. (If
	 * the dependencies do not change, no pruning is required.) 
	 */
	function startTracking(sub: ReactiveNode): void {
		sub.depsTail = undefined;
		sub.flags = (sub.flags & ~(ReactiveFlags.Recursed | ReactiveFlags.Dirty | ReactiveFlags.Pending)) | ReactiveFlags.RecursedCheck;
	}

	/**
	 * `endTracking(sub)` finishes re-writing `sub`'s deps by pruning deps that
	 * were not linked between the preceding `startTracking(sub)` and this call
	 * to `endTracking(sub)`.
	 */
	function endTracking(sub: ReactiveNode): void {
		const depsTail = sub.depsTail;
		let toRemove = depsTail !== undefined ? depsTail.nextDep : sub.deps;
		while (toRemove !== undefined) {
			toRemove = unlink(toRemove, sub);
		}
		sub.flags &= ~ReactiveFlags.RecursedCheck;
	}

	/**
	 * Check if `sub` is dirty, meaning `sub`'s dependencies changed so sub should
	 * re-run.
	 * ```ts
	 * checkDirty(sub.deps!, sub);
	 * ```
	 */
	function checkDirty(link: Link, sub: ReactiveNode): boolean {
		let stack: Stack<Link> | undefined;
		let checkDepth = 0;

		// This implementation avoids recursion by using an explicit stack.
		// See README.md for the easier-to-understand recursive version.
		top: do {
			const dep = link.dep;
			const depFlags = dep.flags;

			let dirty = false;

			if (sub.flags & ReactiveFlags.Dirty) {
				dirty = true;
			} else if ((depFlags & (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) === (ReactiveFlags.Mutable | ReactiveFlags.Dirty)) {
				if (update(dep)) {
					const subs = dep.subs!;
					if (subs.nextSub !== undefined) {
						shallowPropagate(subs);
					}
					dirty = true;
				}
			} else if ((depFlags & (ReactiveFlags.Mutable | ReactiveFlags.Pending)) === (ReactiveFlags.Mutable | ReactiveFlags.Pending)) {
				if (link.nextSub !== undefined || link.prevSub !== undefined) {
					stack = { value: link, prev: stack };
				}
				link = dep.deps!;
				sub = dep;
				++checkDepth;
				continue;
			}

			if (!dirty && link.nextDep !== undefined) {
				link = link.nextDep;
				continue;
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
					sub.flags &= ~ReactiveFlags.Pending;
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

	/**
	 * Notify the direct subscribers of a node that they are Dirty.
	 * Only affects subscriber nodes already marked Pending by `propagate`.
	 * 
	 * ```ts
	 * if (checkDirty(maybeDirty.deps!, maybeDirty)) {
	 *   if (update(maybeDirty)) {
	 *     maybeDirty.subs && shallowPropagate(maybeDirty.subs);
	 *   }
	 * }
	 * ```
	 */
	function shallowPropagate(link: Link): void {
		do {
			const sub = link.sub;
			const nextSub = link.nextSub;
			const subFlags = sub.flags;
			if ((subFlags & (ReactiveFlags.Pending | ReactiveFlags.Dirty)) === ReactiveFlags.Pending) {
				sub.flags = subFlags | ReactiveFlags.Dirty;
				if (subFlags & ReactiveFlags.Watching) {
					notify(sub);
				}
			}
			link = nextSub!;
		} while (link !== undefined);
	}

	/**
	 * Check if `checkLink` is a link in `sub.deps`
	 */
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
