import { Dependency, Link, Subscriber, SubscriberFlags, createReactiveSystem as _createReactiveSystem } from '../system';

export function createReactiveSystem({
	shouldCheckDirty,
	updateComputed,
	notifyEffect,
	onWatched,
	onUnwatched,
}: {
	shouldCheckDirty(computed: Dependency & Subscriber): boolean;
	onWatched(dep: Dependency): void;
	onUnwatched(dep: Dependency): void;
} & Parameters<typeof _createReactiveSystem>[0]) {
	const system = _createReactiveSystem({
		updateComputed,
		notifyEffect,
		checkDirty(link) {
			let stack = 0;
			let dirty: boolean;

			top: do {
				dirty = false;
				const dep = link.dep;
				if (link.version !== dep.version) {
					dirty = true;
				} else if ('flags' in dep) {
					const depFlags = dep.flags;
					if (depFlags & SubscriberFlags.Computed) {
						if (depFlags & SubscriberFlags.Dirty) {
							if (updateComputed(dep)) {
								const subs = dep.subs!;
								if (subs.nextSub !== undefined) {
									shallowPropagate(subs);
								}
								dirty = true;
							}
						} else if (dep.subs === undefined) {
							if (shouldCheckDirty(dep)) {
								dep.subs = link;
								link = dep.deps!;
								++stack;
								continue;
							}
						} else if (depFlags & SubscriberFlags.PendingComputed) {
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
					let sub = link.sub as Dependency & Subscriber;
					do {
						--stack;
						const subSubs = sub.subs!;

						if (sub.subsTail !== undefined) {
							if (dirty) {
								if (updateComputed(sub)) {
									if ((link = subSubs.prevSub!) !== undefined) {
										subSubs.prevSub = undefined;
										shallowPropagate(sub.subs!);
										sub = link.sub as Dependency & Subscriber;
									} else {
										sub = subSubs.sub as Dependency & Subscriber;
									}
									continue;
								}
							} else {
								sub.flags &= ~SubscriberFlags.PendingComputed;
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
						} else {
							sub.subs = undefined;
							if (dirty) {
								if (updateComputed(sub)) {
									link = subSubs;
									sub = subSubs.sub as Dependency & Subscriber;
									continue;
								}
							}
							link = subSubs;
							if (link.nextDep !== undefined) {
								link = link.nextDep;
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
	});
	const { shallowPropagate, isValidLink } = system;

	return {
		...system,
		link(dep: Dependency, sub: Subscriber) {
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
			const newLink: Link = {
				version: dep.version,
				dep,
				sub,
				nextDep,
				prevSub: undefined,
				nextSub: undefined,
			};
			if (currentDep === undefined) {
				sub.deps = newLink;
			} else {
				currentDep.nextDep = newLink;
			}
			sub.depsTail = newLink;
			if (
				sub.flags & SubscriberFlags.Effect
				|| (
					sub.flags & SubscriberFlags.Computed
					&& (sub as Subscriber & Dependency).subs !== undefined
				)
			) {
				if (dep.subs === undefined) {
					dep.subs = newLink;
				} else {
					const oldTail = dep.subsTail!;
					newLink.prevSub = oldTail;
					oldTail.nextSub = newLink;
				}
				dep.subsTail = newLink;
				if (dep.subs === dep.subsTail) {
					if ('flags' in dep) {
						if ((dep as Dependency & Subscriber).flags & SubscriberFlags.Computed) {
							onWatch(dep as Dependency & Subscriber);
						}
					} else {
						onWatched(dep);
					}
				}
			}
		},
		endTracking(sub: Subscriber): void {
			const flags = sub.flags;
			if (
				flags & SubscriberFlags.Effect
				|| (
					flags & SubscriberFlags.Computed
					&& (sub as Subscriber & Dependency).subs !== undefined
				)
			) {
				const depsTail = sub.depsTail;
				if (depsTail !== undefined) {
					const nextDep = depsTail.nextDep;
					if (nextDep !== undefined) {
						onUnwatch(nextDep);
						depsTail.nextDep = undefined;
					}
				} else if (sub.deps !== undefined) {
					onUnwatch(sub.deps);
					sub.deps = undefined;
				}
			} else {
				const depsTail = sub.depsTail;
				if (depsTail !== undefined) {
					const nextDep = depsTail.nextDep;
					if (nextDep !== undefined) {
						depsTail.nextDep = undefined;
					}
				} else if (sub.deps !== undefined) {
					sub.deps = undefined;
				}
			}
			sub.flags &= ~SubscriberFlags.Tracking;
		},
	};

	function onUnwatch(link: Link): void {
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

			if (dep.subs === undefined) {
				if ('flags' in dep) {
					if ((dep as Dependency & Subscriber).flags & SubscriberFlags.Computed) {
						const depLink = dep.deps;
						if (depLink !== undefined) {
							onUnwatch(depLink);
						}
						onUnwatched(dep);
					}
				} else {
					onUnwatched(dep);
				}
			}
			link = link.nextDep!;
		} while (link !== undefined);
	}

	function onWatch(sub: Dependency & Subscriber): void {
		let link = sub.deps;
		while (link !== undefined) {
			const dep = link.dep as Dependency | Dependency & Subscriber;
			const unwatched = dep.subs === undefined;
			if (dep.subs === undefined) {
				dep.subs = link;
			} else {
				const oldTail = dep.subsTail!;
				link.prevSub = oldTail;
				oldTail.nextSub = link;
			}
			dep.subsTail = link;
			if (unwatched) {
				if ('flags' in dep) {
					if ((dep as Dependency & Subscriber).flags & SubscriberFlags.Computed) {
						onWatch(dep);
					}
				} else {
					onWatched(dep);
				}
			}
			link = link.nextDep;
		}
		onWatched(sub);
	}
}
