export interface Dependency {
	version?: number;
	subs: Link | undefined;
	subsTail: Link | undefined;
}

export interface Subscriber {
	flags: SubscriberFlags;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

export interface Link {
	version: number | undefined;
	dep: Dependency | (Dependency & Subscriber);
	sub: Subscriber | (Dependency & Subscriber);
	// Reused to link the previous stack in updateDirtyFlag
	// Reused to link the previous stack in propagate
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	// Reused to link the notify effect in queuedEffects
	nextDep: Link | undefined;
}

export const enum SubscriberFlags {
	None = 0,
	Computed = 1 << 0,
	Effect = 1 << 1,
	Tracking = 1 << 2,
	Recursed = 1 << 3,
	Dirty = 1 << 4,
	Pending = 1 << 5,
	Cold = 1 << 6,
	Propagated = Dirty | Pending,
}

export function createReactiveSystem({
	computed: {
		update: updateComputed,
		onUnwatched: onUnwatchedComputed = () => { },
	},
	effect: {
		notify: notifyEffect,
	},
}: {
	computed: {
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
		onUnwatched?: (computed: Dependency & Subscriber) => void;
	};
	effect: {
		/**
		 * Handles effect notifications by processing the specified `effect`.
		 * 
		 * When an `effect` first receives any of the following flags:
		 *   - `Dirty`
		 *   - `PendingComputed`
		 *   - `PendingEffect`
		 * this method will process them and return `true` if the flags are successfully handled.
		 * If not fully handled, future changes to these flags will trigger additional calls
		 * until the method eventually returns `true`.
		 */
		notify(effect: Subscriber): void;
	};
}) {
	let queuedEffects: Subscriber | undefined;
	let queuedEffectsTail: Subscriber | undefined;

	return {
		/**
		 * Links a given dependency and subscriber if they are not already linked.
		 * 
		 * @param dep - The dependency to be linked.
		 * @param sub - The subscriber that depends on this dependency.
		 * @returns The newly created link object if the two are not already linked; otherwise `undefined`.
		 */
		link(dep: Dependency, sub: Subscriber): Link | undefined {
			const currentDep = sub.depsTail;
			if (
				currentDep !== undefined
				&& currentDep.dep === dep
			) {
				return;
			}
			const nextDep = currentDep !== undefined
				? currentDep.nextDep
				: sub.deps;
			if (
				nextDep !== undefined
				&& nextDep.dep === dep
			) {
				nextDep.version = dep.version;
				sub.depsTail = nextDep;
				return;
			}
			const depLastSub = dep.subsTail;
			if (
				depLastSub !== undefined
				&& depLastSub.sub === sub
				&& isValidLink(depLastSub, sub)
			) {
				return;
			}
			return linkNewDep(dep, sub, nextDep, currentDep);
		},
		/**
		 * Traverses and marks subscribers starting from the provided link.
		 * 
		 * It sets flags (e.g., Dirty, PendingComputed, PendingEffect) on each subscriber
		 * to indicate which ones require re-computation or effect processing. 
		 * This function should be called after a signal's value changes.
		 * 
		 * @param link - The starting link from which propagation begins.
		 */
		propagate(link: Link): void {
			let targetFlag = SubscriberFlags.Dirty | SubscriberFlags.Pending;
			let subs = link;
			let stack = 0;

			top: do {
				const sub = link.sub;
				const subFlags = sub.flags;

				if (
					(
						!(subFlags & (SubscriberFlags.Tracking | SubscriberFlags.Recursed | SubscriberFlags.Propagated))
						&& (sub.flags = subFlags | targetFlag, true)
					)
					|| (
						(subFlags & SubscriberFlags.Recursed)
						&& !(subFlags & SubscriberFlags.Tracking)
						&& (sub.flags = (subFlags & ~SubscriberFlags.Recursed) | targetFlag, true)
					)
					|| (
						!(subFlags & SubscriberFlags.Propagated)
						&& isValidLink(link, sub)
						&& (
							sub.flags = subFlags | SubscriberFlags.Recursed | targetFlag,
							(sub as Dependency).subs !== undefined
						)
					)
				) {
					const subSubs = (sub as Dependency).subs;
					if (subSubs !== undefined) {
						if (subSubs.nextSub !== undefined) {
							subSubs.prevSub = subs;
							link = subs = subSubs;
							++stack;
						} else {
							link = subSubs;
						}
						targetFlag = SubscriberFlags.Pending;
						continue;
					}
					if (subFlags & SubscriberFlags.Effect) {
						if (queuedEffectsTail !== undefined) {
							queuedEffectsTail.depsTail!.nextDep = sub.deps;
						} else {
							queuedEffects = sub;
						}
						queuedEffectsTail = sub;
					}
				} else if (!(subFlags & (SubscriberFlags.Tracking | targetFlag))) {
					sub.flags = subFlags | targetFlag;
					if (subFlags & SubscriberFlags.Effect && !isQueued(sub)) {
						if (queuedEffectsTail !== undefined) {
							queuedEffectsTail.depsTail!.nextDep = sub.deps;
						} else {
							queuedEffects = sub;
						}
						queuedEffectsTail = sub;
					}
				} else if (
					!(subFlags & targetFlag)
					&& (subFlags & SubscriberFlags.Propagated)
					&& isValidLink(link, sub)
				) {
					sub.flags = subFlags | targetFlag;
				}

				if ((link = subs.nextSub!) !== undefined) {
					subs = link;
					targetFlag = stack
						? SubscriberFlags.Pending
						: SubscriberFlags.Dirty | SubscriberFlags.Pending;
					continue;
				}

				while (stack) {
					--stack;
					const dep = subs.dep;
					const depSubs = dep.subs!;
					subs = depSubs.prevSub!;
					depSubs.prevSub = undefined;
					if ((link = subs.nextSub!) !== undefined) {
						subs = link;
						targetFlag = stack
							? SubscriberFlags.Pending
							: SubscriberFlags.Dirty | SubscriberFlags.Pending;
						continue top;
					}
				}

				break;
			} while (true);
		},
		/**
		 * Prepares the given subscriber to track new dependencies.
		 * 
		 * It resets the subscriber's internal pointers (e.g., depsTail) and
		 * sets its flags to indicate it is now tracking dependency links.
		 * 
		 * @param sub - The subscriber to start tracking.
		 */
		startTracking(sub: Subscriber): void {
			sub.depsTail = undefined;
			sub.flags = (sub.flags & ~(SubscriberFlags.Recursed | SubscriberFlags.Propagated)) | SubscriberFlags.Tracking;
		},
		/**
		 * Concludes tracking of dependencies for the specified subscriber.
		 * 
		 * It clears or unlinks any tracked dependency information, then
		 * updates the subscriber's flags to indicate tracking is complete.
		 * 
		 * @param sub - The subscriber whose tracking is ending.
		 */
		endTracking(sub: Subscriber): void {
			const depsTail = sub.depsTail;
			if (depsTail !== undefined) {
				const nextDep = depsTail.nextDep;
				if (nextDep !== undefined) {
					unlink(nextDep);
					depsTail.nextDep = undefined;
				}
			} else if (sub.deps !== undefined) {
				unlink(sub.deps);
				sub.deps = undefined;
			}
			sub.flags &= ~SubscriberFlags.Tracking;
		},
		/**
		 * Recursively checks and updates all computed subscribers marked as pending.
		 * 
		 * It traverses the linked structure using a stack mechanism. For each computed
		 * subscriber in a pending state, updateComputed is called and shallowPropagate
		 * is triggered if a value changes. Returns whether any updates occurred.
		 * 
		 * @param link - The starting link representing a sequence of pending computeds.
		 * @returns `true` if a computed was updated, otherwise `false`.
		 */
		checkDirty(link: Link): boolean {
			let stack = 0;
			let dirty: boolean;

			top: do {
				dirty = false;
				const dep = link.dep;

				if (dep.version !== link.version) {
					dirty = true;
				} else if ('flags' in dep) {
					const depFlags = dep.flags;
					if ((depFlags & (SubscriberFlags.Computed | SubscriberFlags.Dirty)) === (SubscriberFlags.Computed | SubscriberFlags.Dirty)) {
						if (updateComputed(dep)) {
							dirty = true;
						}
					} else if ((depFlags & (SubscriberFlags.Computed | SubscriberFlags.Pending)) === (SubscriberFlags.Computed | SubscriberFlags.Pending)) {
						const depSubs = dep.subs!;
						if (depSubs.nextSub !== undefined) {
							depSubs.prevSub = link;
						}
						link = dep.deps!;
						++stack;
						continue;
					}
				}

				if (!dirty && link.nextDep !== undefined) {
					link = link.nextDep;
					continue;
				}

				if (stack) {
					let sub = link.sub as Dependency & Subscriber;
					do {
						--stack;
						const subSubs = sub.subs!;

						if (dirty) {
							if (updateComputed(sub)) {
								if ((link = subSubs.prevSub!) !== undefined) {
									subSubs.prevSub = undefined;
									sub = link.sub as Dependency & Subscriber;
								} else {
									sub = subSubs.sub as Dependency & Subscriber;
								}
								continue;
							}
						} else {
							sub.flags &= ~SubscriberFlags.Pending;
						}

						if ((link = subSubs.prevSub!) !== undefined) {
							subSubs.prevSub = undefined;
							if (link.nextDep !== undefined) {
								link = link.nextDep;
								continue top;
							}
							sub = link.sub as Dependency & Subscriber;
						} else {
							if ((link = subSubs.nextDep!) !== undefined) {
								continue top;
							}
							sub = subSubs.sub as Dependency & Subscriber;
						}

						dirty = false;
					} while (stack);
				}

				return dirty;
			} while (true);
		},
		/**
		 * Ensures all pending internal effects for the given subscriber are processed.
		 * 
		 * This should be called after an effect decides not to re-run itself but may still
		 * have dependencies flagged with PendingEffect. If the subscriber is flagged with
		 * PendingEffect, this function clears that flag and invokes `notifyEffect` on any
		 * related dependencies marked as Effect and Propagated, processing pending effects.
		 * 
		 * @param sub - The subscriber which may have pending effects.
		 * @param flags - The current flags on the subscriber to check.
		 */
		processPendingInnerEffects(sub: Subscriber): void {
			let link = sub.deps!;
			do {
				const dep = link.dep;
				if (
					'flags' in dep
					&& dep.flags & SubscriberFlags.Effect
					&& dep.flags & SubscriberFlags.Propagated
				) {
					notifyEffect(dep);
				}
				link = link.nextDep!;
			} while (link !== undefined);
		},
		/**
		 * Processes queued effect notifications after a batch operation finishes.
		 * 
		 * Iterates through all queued effects, calling notifyEffect on each.
		 * If an effect remains partially handled, its flags are updated, and future
		 * notifications may be triggered until fully handled.
		 */
		processEffectNotifications(): void {
			while (queuedEffects !== undefined) {
				const effect = queuedEffects;
				const depsTail = effect.depsTail!;
				const queuedNext = depsTail.nextDep;
				if (queuedNext !== undefined) {
					depsTail.nextDep = undefined;
					queuedEffects = queuedNext.sub;
				} else {
					queuedEffects = undefined;
					queuedEffectsTail = undefined;
				}
				notifyEffect(effect);
			}
		},
		warming,
		cooling,
	};

	function isQueued(effect: Subscriber) {
		let queuedEffect = queuedEffects;
		while (queuedEffect !== undefined) {
			if (queuedEffect === effect) {
				return true;
			}
			queuedEffect = queuedEffect.depsTail!.nextDep?.sub;
		}
		return false;
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
			version: dep.version,
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
	function unlink(link: Link): void {
		do {
			const dep = link.dep;
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
				const depDeps = dep.deps;
				if (depDeps !== undefined) {
					const depFlags = dep.flags;
					if (depFlags & SubscriberFlags.Effect) {
						unlink(depDeps);
						dep.deps = undefined;
						dep.depsTail = undefined;
					} else if (depFlags & SubscriberFlags.Computed) {
						onUnwatchedComputed(dep);
					}
				}
			}
		} while ((link = link.nextDep!) !== undefined);
	}

	function warming(sub: Subscriber & Dependency) {
		sub.flags &= ~SubscriberFlags.Cold;
		let link = sub.deps!;
		do {
			const dep = link.dep as Dependency | Dependency & Subscriber;
			if (dep.subs === undefined) {
				dep.subs = link;
				dep.subsTail = link;
			} else {
				const oldTail = dep.subsTail!;
				link.prevSub = oldTail;
				oldTail.nextSub = link;
				dep.subsTail = link;
			}

			if ('flags' in dep) {
				const depFlags = dep.flags;
				if (depFlags & SubscriberFlags.Cold) {
					warming(dep);
				}
			}
		} while ((link = link.nextDep!) !== undefined);
	}

	function cooling(sub: Subscriber & Dependency) {
		sub.flags |= SubscriberFlags.Cold;
		let link = sub.deps!;
		do {
			const dep = link.dep;
			const nextSub = link.nextSub;
			const prevSub = link.prevSub;

			link.prevSub = undefined;
			link.nextSub = undefined;

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

			if (
				dep.subs === undefined
				&& 'flags' in dep
				&& dep.flags & SubscriberFlags.Computed
				&& dep.deps !== undefined
			) {
				cooling(dep);
			}
		} while ((link = link.nextDep!) !== undefined);
	}
}
