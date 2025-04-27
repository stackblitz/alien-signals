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
	prevDep: Link | undefined;
	nextDep: Link | undefined;
}

interface OneWayLink<T> {
	target: T;
	linked: OneWayLink<T> | undefined;
}

export const enum SubscriberFlags {
	Updatable = 1 << 0,
	Notifiable = 1 << 1,
	Notifiable2 = 1 << 2,
	Tracking = 1 << 3,
	Recursed = 1 << 4,
	Dirty = 1 << 5,
	Pending = 1 << 6,
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
	 * @param computed - The computed subscriber to update.
	 * @returns `true` if the computed subscriber's value changed; otherwise `false`.
	 */
	update(computed: Dependency & Subscriber): boolean;
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
		const depLastSub = dep.subsTail;
		if (depLastSub !== undefined && depLastSub.sub === sub && isValidLink(depLastSub, sub)) {
			return;
		}
		const newLink: Link = {
			dep,
			sub,
			prevDep,
			nextDep,
			prevSub: undefined,
			nextSub: undefined,
		};
		if (prevDep === undefined) {
			sub.deps = newLink;
		} else {
			prevDep.nextDep = newLink;
		}
		if (dep.subs === undefined) {
			dep.subs = newLink;
		} else {
			const oldTail = dep.subsTail!;
			newLink.prevSub = oldTail;
			oldTail.nextSub = newLink;
		}
		if (nextDep !== undefined) {
			nextDep.prevDep = newLink;
		}
		sub.depsTail = newLink;
		dep.subsTail = newLink;
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
		const initLink = current;
		let next = current.nextSub;
		let branchs: OneWayLink<Link | undefined> | undefined;

		top: do {
			const sub = current.sub;
			const subFlags = sub.flags;
			const targetFlag = initLink.dep === current.dep ? SubscriberFlags.Dirty : SubscriberFlags.Pending;

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
						next = current.nextSub;
					}
					continue;
				}
				if (subFlags & SubscriberFlags.Notifiable) {
					notify(sub);
				}
			} else if (!(subFlags & (SubscriberFlags.Tracking | targetFlag))) {
				sub.flags = subFlags | targetFlag;
				if (subFlags & SubscriberFlags.Notifiable2) {
					notify(sub);
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
				continue;
			}

			while (branchs !== undefined) {
				current = branchs!.target!;
				branchs = branchs!.linked;
				if (current !== undefined) {
					next = current.nextSub;
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
		let toRemove = depsTail !== undefined ? depsTail.nextDep : sub.deps;
		while (toRemove !== undefined) {
			toRemove = unlink(toRemove, sub);
		}
		sub.flags &= ~SubscriberFlags.Tracking;
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
				if ((depFlags & (SubscriberFlags.Updatable | SubscriberFlags.Dirty)) === (SubscriberFlags.Updatable | SubscriberFlags.Dirty)) {
					if (update(dep)) {
						const subs = dep.subs!;
						if (subs.nextSub !== undefined) {
							shallowPropagate(subs);
						}
						dirty = true;
					}
				} else if ((depFlags & (SubscriberFlags.Updatable | SubscriberFlags.Pending)) === (SubscriberFlags.Updatable | SubscriberFlags.Pending)) {
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
			const subFlags = sub.flags;
			if ((subFlags & (SubscriberFlags.Pending | SubscriberFlags.Dirty)) === SubscriberFlags.Pending) {
				sub.flags = subFlags | SubscriberFlags.Dirty;
				if (subFlags & SubscriberFlags.Notifiable2) {
					notify(sub);
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
			for (let link = sub.deps; link !== undefined && link !== depsTail; link = link.nextDep) {
				if (link === checkLink) {
					return true;
				}
			}
			return depsTail === checkLink;
		}
		return false;
	}
}
