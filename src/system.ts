export interface Dependency {
	subs: Link | undefined;
	subsTail: Link | undefined;
}

export interface Subscriber {
	flags: SubscriberFlags;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

export interface Link {
	dep: Dependency | (Dependency & Subscriber);
	sub: Subscriber | (Dependency & Subscriber);
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	nextDep: Link | undefined;
}

export interface OneWayLink<T> {
	target: T;
	linked: OneWayLink<T> | undefined;
}

export const enum SubscriberFlags {
	Computed = 1 << 0,
	Effect = 1 << 1,
	Tracking = 1 << 2,
	Recursed = 1 << 3,
	Dirty = 1 << 4,
	Pending = 1 << 5,
}

export function createReactiveSystem({
	updateComputed,
	notifyFlagsSet,
	notifyFlagsUpdate,
}: {
	/**
	 * Updates the computed subscriber's value and returns whether it changed.
	 * 
	 * This function should be called when a computed subscriber is marked as Dirty.
	 * The computed subscriber's getter function is invoked, and its value is updated.
	 * If the value changes, the new value is stored, and the function returns `true`.
	 * 
	 * @param computed - The computed subscriber to update.
	 * @returns `true` if the computed subscriber's value changed; otherwise `false`.
	 */
	updateComputed(computed: Dependency & Subscriber): boolean;
	notifyFlagsSet(effect: Subscriber): void;
	notifyFlagsUpdate(effect: Subscriber): void;
}) {
	return {
		link,
		propagate,
		checkDirty,
		startTracking,
		endTracking,
		processComputedUpdate,
	};

	/**
	 * Links a given dependency and subscriber if they are not already linked.
	 * 
	 * @param dep - The dependency to be linked.
	 * @param sub - The subscriber that depends on this dependency.
	 * @returns The newly created link object if the two are not already linked; otherwise `undefined`.
	 */
	function link(dep: Dependency, sub: Subscriber): Link | undefined {
		const currentDep = sub.depsTail;
		if (currentDep !== undefined && currentDep.dep === dep) {
			return;
		}
		const nextDep = currentDep !== undefined ? currentDep.nextDep : sub.deps;
		if (nextDep !== undefined && nextDep.dep === dep) {
			sub.depsTail = nextDep;
			return;
		}
		const depLastSub = dep.subsTail;
		if (depLastSub !== undefined && depLastSub.sub === sub && isValidLink(depLastSub, sub)) {
			return;
		}
		return linkNewDep(dep, sub, nextDep, currentDep);
	}
	/**
	 * Traverses and marks subscribers starting from the provided link.
	 * 
	 * It sets flags (e.g., Dirty, PendingComputed, PendingEffect) on each subscriber
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
			const subFlags = sub.flags;

			let shouldNotify = false;

			if (!(subFlags & (SubscriberFlags.Tracking | SubscriberFlags.Recursed | SubscriberFlags.Dirty | SubscriberFlags.Pending))) {
				sub.flags = subFlags | targetFlag;
				shouldNotify = true;
			} else if ((subFlags & SubscriberFlags.Recursed) && !(subFlags & SubscriberFlags.Tracking)) {
				sub.flags = (subFlags & ~SubscriberFlags.Recursed) | targetFlag;
				shouldNotify = true;
			} else if (!(subFlags & (SubscriberFlags.Dirty | SubscriberFlags.Pending)) && isValidLink(current, sub)) {
				sub.flags = subFlags | SubscriberFlags.Recursed | targetFlag;
				shouldNotify = (sub as Dependency).subs !== undefined;
			}

			if (shouldNotify) {
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
				if (subFlags & SubscriberFlags.Effect) {
					notifyFlagsSet(sub);
				}
			} else if (!(subFlags & (SubscriberFlags.Tracking | targetFlag))) {
				sub.flags = subFlags | targetFlag;
				if (subFlags & SubscriberFlags.Effect) {
					notifyFlagsUpdate(sub);
				}
			} else if (
				!(subFlags & targetFlag)
				&& (subFlags & (SubscriberFlags.Dirty | SubscriberFlags.Pending))
				&& isValidLink(current, sub)
			) {
				sub.flags = subFlags | targetFlag;
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
		sub.flags = (sub.flags & ~(SubscriberFlags.Recursed | SubscriberFlags.Dirty | SubscriberFlags.Pending)) | SubscriberFlags.Tracking;
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
		if (depsTail !== undefined) {
			const nextDep = depsTail.nextDep;
			if (nextDep !== undefined) {
				clearTracking(nextDep);
				depsTail.nextDep = undefined;
			}
		} else if (sub.deps !== undefined) {
			clearTracking(sub.deps);
			sub.deps = undefined;
		}
		sub.flags &= ~SubscriberFlags.Tracking;
	}
	/**
	 * Updates the computed subscriber if necessary before its value is accessed.
	 * 
	 * If the subscriber is marked Dirty or PendingComputed, this function runs
	 * the provided updateComputed logic and triggers a shallowPropagate for any
	 * downstream subscribers if an actual update occurs.
	 * 
	 * @param computed - The computed subscriber to update.
	 * @param flags - The current flag set for this subscriber.
	 */
	function processComputedUpdate(computed: Dependency & Subscriber, flags: SubscriberFlags): void {
		if (flags & SubscriberFlags.Dirty || checkDirty(computed.deps!)) {
			if (updateComputed(computed)) {
				const subs = computed.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		} else {
			computed.flags = flags & ~SubscriberFlags.Pending;
		}
	}

	/**
	 * Creates and attaches a new link between the given dependency and subscriber.
	 * 
	 * Reuses a link object from the linkPool if available. The newly formed link 
	 * is added to both the dependency's linked list and the subscriber's linked list.
	 * 
	 * @param dep - The dependency to link.
	 * @param sub - The subscriber to be attached to this dependency.
	 * @param nextDep - The next link in the subscriber's chain.
	 * @param depsTail - The current tail link in the subscriber's chain.
	 * @returns The newly created link object.
	 */
	function linkNewDep(dep: Dependency, sub: Subscriber, nextDep: Link | undefined, depsTail: Link | undefined): Link {
		const newLink: Link = {
			dep,
			sub,
			nextDep,
			prevSub: undefined,
			nextSub: undefined,
		};
		if (depsTail === undefined) {
			sub.deps = newLink;
		} else {
			depsTail.nextDep = newLink;
		}
		if (dep.subs === undefined) {
			dep.subs = newLink;
		} else {
			const oldTail = dep.subsTail!;
			newLink.prevSub = oldTail;
			oldTail.nextSub = newLink;
		}
		sub.depsTail = newLink;
		dep.subsTail = newLink;
		return newLink;
	}

	/**
	 * Recursively checks and updates all computed subscribers marked as pending.
	 * 
	 * It traverses the linked structure using a stack mechanism. For each computed
	 * subscriber in a pending state, updateComputed is called and shallowPropagate
	 * is triggered if a value changes. Returns whether any updates occurred.
	 * 
	 * @param current - The starting link representing a sequence of pending computeds.
	 * @returns `true` if a computed was updated, otherwise `false`.
	 */
	function checkDirty(current: Link): boolean {
		let prevLinks: OneWayLink<Link> | undefined;
		let checkDepth = 0;

		top: do {
			const dep = current.dep;

			if ('flags' in dep) {
				const depFlags = dep.flags;
				if ((depFlags & (SubscriberFlags.Computed | SubscriberFlags.Dirty)) === (SubscriberFlags.Computed | SubscriberFlags.Dirty)) {
					if (updateComputed(dep)) {
						if (current.nextSub !== undefined || current.prevSub !== undefined) {
							shallowPropagate(dep.subs!);
						}
						while (checkDepth--) {
							const computed = current.sub as Dependency & Subscriber;
							const firstSub = computed.subs!;
							if (updateComputed(computed)) {
								if (firstSub.nextSub !== undefined) {
									shallowPropagate(firstSub);
									current = prevLinks!.target;
									prevLinks = prevLinks!.linked;
								} else {
									current = firstSub;
								}
								continue;
							}
							if (firstSub.nextSub !== undefined) {
								if ((current = prevLinks!.target.nextDep!) === undefined) {
									return false;
								}
								prevLinks = prevLinks!.linked;
								continue top;
							}
							return false;
						}
						return true;
					}
				} else if ((depFlags & (SubscriberFlags.Computed | SubscriberFlags.Pending)) === (SubscriberFlags.Computed | SubscriberFlags.Pending)) {
					dep.flags = depFlags & ~SubscriberFlags.Pending;
					if (current.nextSub !== undefined || current.prevSub !== undefined) {
						prevLinks = { target: current, linked: prevLinks };
					}
					++checkDepth;
					current = dep.deps!;
					continue;
				}
			}

			if ((current = current.nextDep!) === undefined) {
				return false;
			}
		} while (true);
	}

	/**
	 * Quickly propagates PendingComputed status to Dirty for each subscriber in the chain.
	 * 
	 * If the subscriber is also marked as an effect, it is added to the queuedEffects list
	 * for later processing.
	 * 
	 * @param link - The head of the linked list to process.
	 */
	function shallowPropagate(link: Link): void {
		do {
			const sub = link.sub;
			const subFlags = sub.flags;
			if ((subFlags & (SubscriberFlags.Pending | SubscriberFlags.Dirty)) === SubscriberFlags.Pending) {
				sub.flags = subFlags | SubscriberFlags.Dirty;
				if (subFlags & SubscriberFlags.Effect) {
					notifyFlagsUpdate(sub);
				}
			}
			link = link.nextSub!;
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

	/**
	 * Clears dependency-subscription relationships starting at the given link.
	 * 
	 * Detaches the link from both the dependency and subscriber, then continues 
	 * to the next link in the chain. The link objects are returned to linkPool for reuse.
	 * 
	 * @param link - The head of a linked chain to be cleared.
	 */
	function clearTracking(link: Link): void {
		do {
			const dep = link.dep;
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

			if (dep.subs === undefined && 'deps' in dep) {
				const depFlags = dep.flags;
				if (!(depFlags & SubscriberFlags.Dirty)) {
					dep.flags = depFlags | SubscriberFlags.Dirty;
				}
				const depDeps = dep.deps;
				if (depDeps !== undefined) {
					link = depDeps;
					dep.depsTail!.nextDep = nextDep;
					dep.deps = undefined;
					dep.depsTail = undefined;
					continue;
				}
			}
			link = nextDep!;
		} while (link !== undefined);
	}
}
