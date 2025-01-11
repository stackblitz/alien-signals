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
	Tracking = 1 << 0,
	Recursed = 1 << 1,
	InnerEffectsPending = 1 << 2,
	ToCheckDirty = 1 << 3,
	Dirty = 1 << 4,
	Notified = InnerEffectsPending | ToCheckDirty | Dirty,
}

export function createSystem<
	Computed extends Dependency & Subscriber,
	Effect extends Subscriber
>({
	computed: {
		is: isComputed,
		update: updateComputed,
	},
	effect: {
		is: isEffect,
		notify: notifyEffect,
	},
}: {
	computed: {
		is(sub: Subscriber): sub is Computed;
		update(sub: Computed): boolean;
	},
	effect: {
		is(sub: Subscriber): sub is Effect;
		notify(sub: Effect): void;
	},
}) {
	let queuedEffects: Effect | undefined;
	let queuedEffectsTail: Effect | undefined;
	let linkPool: Link | undefined;

	return {
		link,
		shallowPropagate,
		propagate,
		startTrack,
		endTrack,
		isDirty,
		drainQueuedEffects,
		runInnerEffects,
	};

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

	function drainQueuedEffects(): void {
		while (queuedEffects !== undefined) {
			const effect = queuedEffects;
			const depsTail = effect.depsTail!;
			const queuedNext = depsTail.nextDep;
			if (queuedNext !== undefined) {
				depsTail.nextDep = undefined;
				queuedEffects = queuedNext.sub as Effect;
			} else {
				queuedEffects = undefined;
				queuedEffectsTail = undefined;
			}
			notifyEffect(effect);
		}
	}

	function isDirty(sub: Subscriber, flags: SubscriberFlags): boolean {
		if (flags & SubscriberFlags.Dirty) {
			return true;
		} else if (flags & SubscriberFlags.ToCheckDirty) {
			if (_checkDirty(sub.deps!)) {
				sub.flags = flags | SubscriberFlags.Dirty;
				return true;
			} else {
				sub.flags = flags & ~SubscriberFlags.ToCheckDirty;
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
				if (depFlags & SubscriberFlags.Dirty) {
					if (isComputed(dep) && updateComputed(dep)) {
						const subs = dep.subs!;
						if (subs.nextSub !== undefined) {
							shallowPropagate(subs);
						}
						dirty = true;
					}
				} else if (depFlags & SubscriberFlags.ToCheckDirty) {
					if (isComputed(dep)) {
						const depSubs = dep.subs!;
						if (depSubs.nextSub !== undefined) {
							depSubs.prevSub = link;
						}
						link = dep.deps!;
						++stack;
						continue;
					}
				}
			}

			if (!dirty && link.nextDep !== undefined) {
				link = link.nextDep;
				continue;
			}

			if (stack) {
				let sub = link.sub as Computed;
				do {
					--stack;
					const subSubs = sub.subs!;

					if (dirty) {
						if (updateComputed(sub)) {
							if ((link = subSubs.prevSub!) !== undefined) {
								subSubs.prevSub = undefined;
								shallowPropagate(sub.subs!);
								sub = link.sub as Computed;
							} else {
								sub = subSubs.sub as Computed;
							}
							continue;
						}
					} else {
						sub.flags &= ~SubscriberFlags.ToCheckDirty;
					}

					if ((link = subSubs.prevSub!) !== undefined) {
						subSubs.prevSub = undefined;
						if (link.nextDep !== undefined) {
							link = link.nextDep;
							continue top;
						}
						sub = link.sub as Computed;
					} else {
						if ((link = subSubs.nextDep!) !== undefined) {
							continue top;
						}
						sub = subSubs.sub as Computed;
					}

					dirty = false;
				} while (stack);
			}

			return dirty;
		} while (true);
	}

	function runInnerEffects(link: Link): void {
		do {
			const dep = link.dep;
			if ('deps' in dep && isEffect(dep)) {
				notifyEffect(dep);
			}
			link = link.nextDep!;
		} while (link !== undefined);
	}

	function shallowPropagate(link: Link): void {
		do {
			const updateSub = link.sub;
			const updateSubFlags = updateSub.flags;
			if ((updateSubFlags & (SubscriberFlags.ToCheckDirty | SubscriberFlags.Dirty)) === SubscriberFlags.ToCheckDirty) {
				updateSub.flags = updateSubFlags | SubscriberFlags.Dirty;
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
					!(subFlags & (SubscriberFlags.Tracking | SubscriberFlags.Recursed | SubscriberFlags.Notified))
					&& (sub.flags = subFlags | targetFlag, true)
				)
				|| (
					(subFlags & SubscriberFlags.Recursed)
					&& !(subFlags & SubscriberFlags.Tracking)
					&& (sub.flags = (subFlags & ~SubscriberFlags.Recursed) | targetFlag, true)
				)
				|| (
					!(subFlags & SubscriberFlags.Notified)
					&& _isValidLink(link, sub)
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
						targetFlag = SubscriberFlags.ToCheckDirty;
						++stack;
					} else {
						link = subSubs;
						targetFlag = isEffect(sub)
							? SubscriberFlags.InnerEffectsPending
							: SubscriberFlags.ToCheckDirty;
					}
					continue;
				}
				if (isEffect(sub)) {
					if (queuedEffectsTail !== undefined) {
						queuedEffectsTail.depsTail!.nextDep = sub.deps;
					} else {
						queuedEffects = sub;
					}
					queuedEffectsTail = sub;
				}
			} else if (
				!(subFlags & (SubscriberFlags.Tracking | targetFlag))
				|| (
					!(subFlags & targetFlag)
					&& (subFlags & SubscriberFlags.Notified)
					&& _isValidLink(link, sub)
				)
			) {
				sub.flags = subFlags | targetFlag;
			}

			if ((link = subs.nextSub!) !== undefined) {
				subs = link;
				targetFlag = stack
					? SubscriberFlags.ToCheckDirty
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
						? SubscriberFlags.ToCheckDirty
						: SubscriberFlags.Dirty;
					continue top;
				}
			}

			break;
		} while (true);
	}

	function _isValidLink(subLink: Link, sub: Subscriber): boolean {
		const depsTail = sub.depsTail;
		if (depsTail !== undefined) {
			let link = sub.deps!;
			do {
				if (link === subLink) {
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
		sub.flags = (sub.flags & ~(SubscriberFlags.Recursed | SubscriberFlags.Notified)) | SubscriberFlags.Tracking;
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
