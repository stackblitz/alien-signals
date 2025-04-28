export interface Dependency {
	subs: Link | undefined;
	subsTail: Link | undefined;
}

export interface Subscriber {
	flags: number | SubscriberFlags;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

export interface Link {
	dep: Dependency | (Dependency & Subscriber);
	sub: Subscriber | (Dependency & Subscriber);
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	prevDep: Link | undefined;
	nextDep: Link | undefined;
}

interface OneWayLink<T> {
	target: T;
	linked: OneWayLink<T> | undefined;
}

export const enum SubscriberFlags {
	Mutable = 1 << 0,
	Watching = 1 << 1,
	Running = 1 << 2,
	Recursed = 1 << 3,
	Dirty = 1 << 4,
	Pending = 1 << 5,
}

export function createReactiveSystem({
	update,
	notify,
	unwatched,
}: {
	/**
	 * Updates the computed subscriber's value and returns whether it changed.
	 * 
	 * This function should be called when a computed subscriber is marked as Dirty.
	 * The computed subscriber's getter function is invoked, and its value is updated.
	 * If the value changes, the new value is stored, and the function returns `true`.
	 * 
	 * @param sub - The computed subscriber to update.
	 * @returns `true` if the computed subscriber's value changed; otherwise `false`.
	 */
	update(sub: Dependency & Subscriber): boolean;
	notify(sub: Subscriber): void;
	unwatched(sub: Dependency): void;
}) {
	return {
		link,
		unlink,
		propagate,
		shallowPropagate,
		checkDirty,
		startTracking,
		endTracking,
	};

	/**
	 * Links a given dependency and subscriber if they are not already linked.
	 * 
	 * @param dep - The dependency to be linked.
	 * @param sub - The subscriber that depends on this dependency.
	 * @returns The newly created link object if the two are not already linked; otherwise `undefined`.
	 */
	function link(dep: Dependency, sub: Subscriber): Link | undefined {
		const prevDep = sub.depsTail;
		if (prevDep !== undefined && prevDep.dep === dep) {
			return;
		}
		const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
		if (nextDep !== undefined && nextDep.dep === dep) {
			sub.depsTail = nextDep;
			return;
		}
		const prevSub = dep.subsTail;
		if (prevSub !== undefined && prevSub.sub === sub && isValidLink(prevSub, sub)) {
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
		return newLink;
	}

	function unlink(link: Link, sub: Subscriber = link.sub): Link | undefined {
		const dep = link.dep;
		const prevDep = link.prevDep;
		const nextDep = link.nextDep;
		const nextSub = link.nextSub;
		const prevSub = link.prevSub;
		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
		} else {
			dep.subsTail = prevSub;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		} else {
			dep.subs = nextSub;
		}
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
		if (dep.subs === undefined) {
			unwatched(dep);
		}
		return nextDep;
	}

	/**
	 * Traverses and marks subscribers starting from the provided link.
	 * 
	 * It sets flags (e.g., Dirty, Pending) on each subscriber
	 * to indicate which ones require re-computation or effect processing. 
	 * This function should be called after a signal's value changes.
	 * 
	 * @param current - The starting link from which propagation begins.
	 */
	function propagate(current: Link): void {
		let next = current.nextSub;
		let branchs: OneWayLink<Link | undefined> | undefined;
		let branchDepth = 0;
		let targetFlag = SubscriberFlags.Dirty;

		top: do {
			const sub = current.sub;

			let subFlags = sub.flags;

			if (!(subFlags & (SubscriberFlags.Running | SubscriberFlags.Recursed | SubscriberFlags.Dirty | SubscriberFlags.Pending))) {
				/**
				 * @when Running ❌, Recursed ❌, Dirty ❌
				 * @then Notify ✅, Propagate ✅
				 */
				sub.flags = subFlags | targetFlag;
			} else if (!(subFlags & (SubscriberFlags.Running | SubscriberFlags.Recursed | targetFlag))) {
				/**
				 * @when Running ❌, Recursed ❌, Dirty ⚠️
				 * @then Notify ✅, Propagate ❌
				 */
				sub.flags = subFlags | targetFlag;
				subFlags &= SubscriberFlags.Watching;
			} else if (!(subFlags & (SubscriberFlags.Running | SubscriberFlags.Recursed))) {
				/**
				 * @when Running ❌, Recursed ❌, Dirty ✅
				 * @then Notify ❌, Propagate ❌
				 */
				subFlags = 0;
			} else if (!(subFlags & SubscriberFlags.Running)) {
				/**
				 * @when Running ❌, Recursed ✅, Dirty ✅
				 * @then Notify ✅, Propagate ✅
				 */
				sub.flags = (subFlags & ~SubscriberFlags.Recursed) | targetFlag;
			} else if (isValidLink(current, sub)) {
				if (!(subFlags & (SubscriberFlags.Dirty | SubscriberFlags.Pending))) {
					/**
					 * @when Running ✅, Dirty ❌
					 * @then Notify ❌, Propagate ✅
					 */
					sub.flags = subFlags | SubscriberFlags.Recursed | targetFlag;
					subFlags &= SubscriberFlags.Mutable;
				} else if (!(subFlags & targetFlag)) {
					/**
					 * @when Running ✅, Dirty ⚠️
					 * @then Notify ❌, Propagate ❌
					 */
					sub.flags = subFlags | targetFlag;
					subFlags = 0;
				} else {
					/**
					 * @when Running ✅, Dirty ✅
					 * @then Notify ❌, Propagate ❌
					 */
					subFlags = 0;
				}
			} else {
				subFlags = 0;
			}

			if (subFlags & SubscriberFlags.Watching) {
				notify(sub);
			}

			if (subFlags & SubscriberFlags.Mutable) {
				const subSubs = (sub as Dependency).subs;
				if (subSubs !== undefined) {
					current = subSubs;
					if (subSubs.nextSub !== undefined) {
						branchs = { target: next, linked: branchs };
						++branchDepth;
						next = current.nextSub;
					}
					targetFlag = SubscriberFlags.Pending;
					continue;
				}
			}

			if ((current = next!) !== undefined) {
				next = current.nextSub;
				if (!branchDepth) {
					targetFlag = SubscriberFlags.Dirty;
				}
				continue;
			}

			while (branchDepth--) {
				current = branchs!.target!;
				branchs = branchs!.linked;
				if (current !== undefined) {
					next = current.nextSub;
					if (!branchDepth) {
						targetFlag = SubscriberFlags.Dirty;
					}
					continue top;
				}
			}

			break;
		} while (true);
	}
	/**
	 * Prepares the given subscriber to track new dependencies.
	 * 
	 * It resets the subscriber's internal pointers (e.g., depsTail) and
	 * sets its flags to indicate it is now tracking dependency links.
	 * 
	 * @param sub - The subscriber to start tracking.
	 */
	function startTracking(sub: Subscriber): void {
		sub.depsTail = undefined;
		sub.flags = (sub.flags & ~(SubscriberFlags.Recursed | SubscriberFlags.Dirty | SubscriberFlags.Pending)) | SubscriberFlags.Running;
	}

	/**
	 * Concludes tracking of dependencies for the specified subscriber.
	 * 
	 * It clears or unlinks any tracked dependency information, then
	 * updates the subscriber's flags to indicate tracking is complete.
	 * 
	 * @param sub - The subscriber whose tracking is ending.
	 */
	function endTracking(sub: Subscriber): void {
		const depsTail = sub.depsTail;
		let toRemove = depsTail !== undefined ? depsTail.nextDep : sub.deps;
		while (toRemove !== undefined) {
			toRemove = unlink(toRemove, sub);
		}
		sub.flags &= ~SubscriberFlags.Running;
	}

	/**
	 * Recursively checks and updates all computed subscribers marked as pending.
	 * 
	 * It traverses the linked structure using a stack mechanism. For each computed
	 * subscriber in a pending state, update is called and shallowPropagate
	 * is triggered if a value changes. Returns whether any updates occurred.
	 * 
	 * @param current - The starting link representing a sequence of pending computeds.
	 * @returns `true` if a computed was updated, otherwise `false`.
	 */
	function checkDirty(current: Link): boolean {
		let prevLinks: OneWayLink<Link> | undefined;
		let checkDepth = 0;
		let dirty: boolean;

		top: do {
			dirty = false;
			const dep = current.dep;

			if (current.sub.flags & SubscriberFlags.Dirty) {
				dirty = true;
			} else if ('flags' in dep) {
				const depFlags = dep.flags;
				if ((depFlags & (SubscriberFlags.Mutable | SubscriberFlags.Dirty)) === (SubscriberFlags.Mutable | SubscriberFlags.Dirty)) {
					if (update(dep)) {
						const subs = dep.subs!;
						if (subs.nextSub !== undefined) {
							shallowPropagate(subs);
						}
						dirty = true;
					}
				} else if ((depFlags & (SubscriberFlags.Mutable | SubscriberFlags.Pending)) === (SubscriberFlags.Mutable | SubscriberFlags.Pending)) {
					if (current.nextSub !== undefined || current.prevSub !== undefined) {
						prevLinks = { target: current, linked: prevLinks };
					}
					current = dep.deps!;
					++checkDepth;
					continue;
				}
			}

			if (!dirty && current.nextDep !== undefined) {
				current = current.nextDep;
				continue;
			}

			while (checkDepth) {
				--checkDepth;
				const sub = current.sub as Dependency & Subscriber;
				const firstSub = sub.subs!;
				if (dirty) {
					if (update(sub)) {
						if (firstSub.nextSub !== undefined) {
							current = prevLinks!.target;
							prevLinks = prevLinks!.linked;
							shallowPropagate(firstSub);
						} else {
							current = firstSub;
						}
						continue;
					}
				} else {
					sub.flags &= ~SubscriberFlags.Pending;
				}
				if (firstSub.nextSub !== undefined) {
					current = prevLinks!.target;
					prevLinks = prevLinks!.linked;
				} else {
					current = firstSub;
				}
				if (current.nextDep !== undefined) {
					current = current.nextDep;
					continue top;
				}
				dirty = false;
			}

			return dirty;
		} while (true);
	}

	/**
	 * Quickly propagates Pending status to Dirty for each subscriber in the chain.
	 * 
	 * If the subscriber is also marked as an effect, it is added to the queuedEffects list
	 * for later processing.
	 * 
	 * @param link - The head of the linked list to process.
	 */
	function shallowPropagate(link: Link): void {
		do {
			const sub = link.sub;
			const nextSub = link.nextSub;
			const subFlags = sub.flags;
			if ((subFlags & (SubscriberFlags.Pending | SubscriberFlags.Dirty)) === SubscriberFlags.Pending) {
				sub.flags = subFlags | SubscriberFlags.Dirty;
				if (subFlags & SubscriberFlags.Watching) {
					notify(sub);
				}
			}
			link = nextSub!;
		} while (link !== undefined);
	}

	/**
	 * Verifies whether the given link is valid for the specified subscriber.
	 * 
	 * It iterates through the subscriber's link list (from sub.deps to sub.depsTail)
	 * to determine if the provided link object is part of that chain.
	 * 
	 * @param checkLink - The link object to validate.
	 * @param sub - The subscriber whose link list is being checked.
	 * @returns `true` if the link is found in the subscriber's list; otherwise `false`.
	 */
	function isValidLink(checkLink: Link, sub: Subscriber): boolean {
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
