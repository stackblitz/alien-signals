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
	// Reuse to link prev stack in checkDirty
	// Reuse to link prev stack in propagate
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	// Reuse to link next released link in linkPool
	// Reuse to link notify effect in queuedEffects
	nextDep: Link | undefined;
}

export const enum SubscriberFlags {
	None = 0,
	IsComputed = 1 << 0,
	IsEffect = 1 << 1,
	Tracking = 1 << 2,
	Notified = 1 << 3,
	Recursed = 1 << 4,
	InnerEffectsPending = 1 << 5,
	CheckRequired = 1 << 6,
	Dirty = 1 << 7,
	Propagated = InnerEffectsPending | CheckRequired | Dirty,
}

export function createSystem({
	updateComputed,
	notifyEffect,
}: {
	updateComputed(computed: Dependency & Subscriber): boolean;
	notifyEffect(effect: Subscriber): boolean;
}) {
	let pendingEffects: Subscriber | undefined;
	let pendingEffectsTail: Subscriber | undefined;
	let linkPool: Link | undefined;

	return {
		link,
		propagate,
		startTrack,
		endTrack,
		isDirty,
		processComputedUpdate,
		processPendingInnerEffects,
		processEffectNotifications,
	};

	/**
	 * Link a dependency to a subscriber.
	 * @returns `true` if the link is new.
	 */
	function link(dep: Dependency, sub: Subscriber): boolean {
		const currentDep = sub.depsTail;
		if (
			currentDep !== undefined
			&& currentDep.dep === dep
		) {
			return false;
		}
		const nextDep = currentDep !== undefined
			? currentDep.nextDep
			: sub.deps;
		if (
			nextDep !== undefined
			&& nextDep.dep === dep
		) {
			sub.depsTail = nextDep;
			return false;
		}
		const depLastSub = dep.subsTail;
		if (
			depLastSub !== undefined
			&& depLastSub.sub === sub
			&& _isValidLink(depLastSub, sub)
		) {
			return false;
		}
		_linkNewDep(dep, sub, nextDep, currentDep);
		return true;
	}

	function _linkNewDep(dep: Dependency, sub: Subscriber, nextDep: Link | undefined, depsTail: Link | undefined): void {
		let newLink: Link;

		if (linkPool !== undefined) {
			newLink = linkPool;
			linkPool = newLink.nextDep;
			newLink.nextDep = nextDep;
			newLink.dep = dep;
			newLink.sub = sub;
		} else {
			newLink = {
				dep,
				sub,
				nextDep,
				prevSub: undefined,
				nextSub: undefined,
			};
		}

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
	}

	function processEffectNotifications(): void {
		while (pendingEffects !== undefined) {
			const effect = pendingEffects;
			const depsTail = effect.depsTail!;
			const queuedNext = depsTail.nextDep;
			if (queuedNext !== undefined) {
				depsTail.nextDep = undefined;
				pendingEffects = queuedNext.sub;
			} else {
				pendingEffects = undefined;
				pendingEffectsTail = undefined;
			}
			if (!notifyEffect(effect)) {
				effect.flags &= ~SubscriberFlags.Notified;
			}
		}
	}

	/**
	 * Process pending effects. This function should be called when subscriber flags include `InnerEffectsPending`.
	 */
	function processPendingInnerEffects(link: Link): void {
		do {
			const dep = link.dep;
			if (
				'flags' in dep
				&& dep.flags & SubscriberFlags.IsEffect
				&& dep.flags & SubscriberFlags.Propagated
			) {
				notifyEffect(dep);
			}
			link = link.nextDep!;
		} while (link !== undefined);
	}

	function processComputedUpdate(computed: Dependency & Subscriber, flags: SubscriberFlags): void {
		if (flags & SubscriberFlags.Dirty) {
			if (updateComputed(computed)) {
				const subs = computed.subs;
				if (subs !== undefined) {
					_shallowPropagate(subs);
				}
			}
		}
		else if (flags & SubscriberFlags.CheckRequired) {
			if (_checkDirty(computed.deps!)) {
				if (updateComputed(computed)) {
					const subs = computed.subs;
					if (subs !== undefined) {
						_shallowPropagate(subs);
					}
				}
			} else {
				computed.flags &= ~SubscriberFlags.CheckRequired;
			}
		}
	}

	function isDirty(sub: Subscriber, flags: SubscriberFlags): boolean {
		if (flags & SubscriberFlags.Dirty) {
			return true;
		}
		else if (flags & SubscriberFlags.CheckRequired) {
			if (_checkDirty(sub.deps!)) {
				sub.flags = flags | SubscriberFlags.Dirty;
				return true;
			} else {
				sub.flags &= ~SubscriberFlags.CheckRequired;
			}
		}
		return false;
	}

	// See https://github.com/stackblitz/alien-signals#about-propagate-and-checkdirty-functions
	function _checkDirty(link: Link): boolean {
		let stack = 0;
		let dirty: boolean;

		top: do {
			dirty = false;
			const dep = link.dep;

			if ('flags' in dep) {
				const depFlags = dep.flags;
				if ((depFlags & (SubscriberFlags.IsComputed | SubscriberFlags.Dirty)) === (SubscriberFlags.IsComputed | SubscriberFlags.Dirty)) {
					if (updateComputed(dep)) {
						const subs = dep.subs!;
						if (subs.nextSub !== undefined) {
							_shallowPropagate(subs);
						}
						dirty = true;
					}
				} else if ((depFlags & (SubscriberFlags.IsComputed | SubscriberFlags.CheckRequired)) === (SubscriberFlags.IsComputed | SubscriberFlags.CheckRequired)) {
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
								_shallowPropagate(sub.subs!);
								sub = link.sub as Dependency & Subscriber;
							} else {
								sub = subSubs.sub as Dependency & Subscriber;
							}
							continue;
						}
					} else {
						sub.flags &= ~SubscriberFlags.CheckRequired;
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
	}

	function _shallowPropagate(link: Link): void {
		do {
			const sub = link.sub;
			const subFlags = sub.flags;
			if ((subFlags & (SubscriberFlags.CheckRequired | SubscriberFlags.Dirty)) === SubscriberFlags.CheckRequired) {
				sub.flags = subFlags | SubscriberFlags.Dirty | SubscriberFlags.Notified;
				if ((subFlags & (SubscriberFlags.IsEffect | SubscriberFlags.Notified)) === SubscriberFlags.IsEffect) {
					if (pendingEffectsTail !== undefined) {
						pendingEffectsTail.depsTail!.nextDep = sub.deps;
					} else {
						pendingEffects = sub;
					}
					pendingEffectsTail = sub;
				}
			}
			link = link.nextSub!;
		} while (link !== undefined);
	}

	// See https://github.com/stackblitz/alien-signals#about-propagate-and-checkdirty-functions
	function propagate(link: Link): void {
		let targetFlag = SubscriberFlags.Dirty;
		let subs = link;
		let stack = 0;

		top: do {
			const sub = link.sub;
			const subFlags = sub.flags;

			if (
				(
					!(subFlags & (SubscriberFlags.Tracking | SubscriberFlags.Recursed | SubscriberFlags.Propagated))
					&& (sub.flags = subFlags | targetFlag | SubscriberFlags.Notified, true)
				)
				|| (
					(subFlags & SubscriberFlags.Recursed)
					&& !(subFlags & SubscriberFlags.Tracking)
					&& (sub.flags = (subFlags & ~SubscriberFlags.Recursed) | targetFlag | SubscriberFlags.Notified, true)
				)
				|| (
					!(subFlags & SubscriberFlags.Propagated)
					&& _isValidLink(link, sub)
					&& (
						sub.flags = subFlags | SubscriberFlags.Recursed | targetFlag | SubscriberFlags.Notified,
						(sub as Dependency).subs !== undefined
					)
				)
			) {
				const subSubs = (sub as Dependency).subs;
				if (subSubs !== undefined) {
					if (subSubs.nextSub !== undefined) {
						subSubs.prevSub = subs;
						link = subs = subSubs;
						targetFlag = SubscriberFlags.CheckRequired;
						++stack;
					} else {
						link = subSubs;
						targetFlag = subFlags & SubscriberFlags.IsEffect
							? SubscriberFlags.InnerEffectsPending
							: SubscriberFlags.CheckRequired;
					}
					continue;
				}
				if (subFlags & SubscriberFlags.IsEffect) {
					if (pendingEffectsTail !== undefined) {
						pendingEffectsTail.depsTail!.nextDep = sub.deps;
					} else {
						pendingEffects = sub;
					}
					pendingEffectsTail = sub;
				}
			} else if (!(subFlags & (SubscriberFlags.Tracking | targetFlag))) {
				sub.flags = subFlags | targetFlag | SubscriberFlags.Notified;
				if ((subFlags & (SubscriberFlags.IsEffect | SubscriberFlags.Notified)) === SubscriberFlags.IsEffect) {
					if (pendingEffectsTail !== undefined) {
						pendingEffectsTail.depsTail!.nextDep = sub.deps;
					} else {
						pendingEffects = sub;
					}
					pendingEffectsTail = sub;
				}
			} else if (
				!(subFlags & targetFlag)
				&& (subFlags & SubscriberFlags.Propagated)
				&& _isValidLink(link, sub)
			) {
				sub.flags = subFlags | targetFlag;
			}

			if ((link = subs.nextSub!) !== undefined) {
				subs = link;
				targetFlag = stack
					? SubscriberFlags.CheckRequired
					: SubscriberFlags.Dirty;
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
						? SubscriberFlags.CheckRequired
						: SubscriberFlags.Dirty;
					continue top;
				}
			}

			break;
		} while (true);
	}

	/**
	 * Check if `sub.deps` include the given checkLink.
	 */
	function _isValidLink(checkLink: Link, sub: Subscriber): boolean {
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

	function startTrack(sub: Subscriber): void {
		sub.depsTail = undefined;
		sub.flags = (sub.flags & ~(SubscriberFlags.Notified | SubscriberFlags.Recursed | SubscriberFlags.Propagated)) | SubscriberFlags.Tracking;
	}

	function endTrack(sub: Subscriber): void {
		const depsTail = sub.depsTail;
		if (depsTail !== undefined) {
			const nextDep = depsTail.nextDep;
			if (nextDep !== undefined) {
				_clearTrack(nextDep);
				depsTail.nextDep = undefined;
			}
		} else if (sub.deps !== undefined) {
			_clearTrack(sub.deps);
			sub.deps = undefined;
		}
		sub.flags &= ~SubscriberFlags.Tracking;
	}

	function _clearTrack(link: Link): void {
		do {
			const dep = link.dep;
			const nextDep = link.nextDep;
			const nextSub = link.nextSub;
			const prevSub = link.prevSub;

			if (nextSub !== undefined) {
				nextSub.prevSub = prevSub;
				link.nextSub = undefined;
			} else {
				dep.subsTail = prevSub;
			}

			if (prevSub !== undefined) {
				prevSub.nextSub = nextSub;
				link.prevSub = undefined;
			} else {
				dep.subs = nextSub;
			}

			// @ts-expect-error
			link.dep = undefined;
			// @ts-expect-error
			link.sub = undefined;
			link.nextDep = linkPool;
			linkPool = link;

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
