export interface IEffect {
	nextNotify: IEffect | undefined;
	notify(): void;
}

export interface Dependency {
	subs: Link | undefined;
	subsTail: Link | undefined;
	subVersion: number;
	run?(): void;
}

export interface Subscriber {
	/**
	 * Represents either the version or the dirty level of the dependency.
	 * 
	 * - When tracking is active, this property holds the version number.
	 * - When tracking is not active, this property holds the dirty level.
	 */
	versionOrDirtyLevel: number | DirtyLevels;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

export interface Link {
	dep: Dependency;
	sub: Subscriber & ({} | IEffect | Dependency);
	prevSubOrUpdate: Link | undefined;
	nextSub: Link | undefined;
	nextDep: Link | undefined;
	prevPropagateOrNextReleased: Link | undefined;
}

export const enum DirtyLevels {
	NotDirty,
	MaybeDirty,
	Dirty,
}

export namespace System {

	export let activeSub: Subscriber | undefined = undefined;
	export let activeSubScope: Subscriber | undefined = undefined;
	export let activeSubsDepth = 0;
	export let batchDepth = 0;
	export let subVersion = DirtyLevels.Dirty + 1;
	export let queuedEffects: IEffect | undefined = undefined;
	export let queuedEffectsTail: IEffect | undefined = undefined;

	export function startBatch() {
		batchDepth++;
	}

	export function endBatch() {
		batchDepth--;
		while (batchDepth === 0 && queuedEffects !== undefined) {
			const effect = queuedEffects;
			const queuedNext = queuedEffects.nextNotify;
			if (queuedNext !== undefined) {
				queuedEffects.nextNotify = undefined;
				queuedEffects = queuedNext;
			} else {
				queuedEffects = undefined;
				queuedEffectsTail = undefined;
			}
			effect.notify();
		}
	}
}

export namespace Link {

	let pool: Link | undefined = undefined;

	export function get(dep: Dependency, sub: Subscriber): Link {
		if (pool !== undefined) {
			const link = pool;
			pool = link.prevPropagateOrNextReleased;
			link.prevPropagateOrNextReleased = undefined;
			link.dep = dep;
			link.sub = sub;
			return link;
		} else {
			return {
				dep,
				sub,
				prevSubOrUpdate: undefined,
				nextSub: undefined,
				nextDep: undefined,
				prevPropagateOrNextReleased: undefined,
			};
		}
	}

	export function releaseDeps(toBreak: Link) {
		let nextDep = toBreak.nextDep;
		while (nextDep !== undefined) {
			toBreak.nextDep = undefined;
			const nextNext = nextDep.nextDep;
			Link.release(nextDep);
			toBreak = nextDep;
			nextDep = nextNext;
		}
	}

	export function release(link: Link) {
		const dep = link.dep as Dependency & ({} | Subscriber);
		const nextSub = link.nextSub;
		const prevSub = link.prevSubOrUpdate;

		if (nextSub !== undefined) {
			nextSub.prevSubOrUpdate = prevSub;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		}

		if (nextSub === undefined) {
			link.dep.subsTail = prevSub;
		}
		if (prevSub === undefined) {
			link.dep.subs = nextSub;
		}

		// @ts-ignore
		link.dep = undefined;
		// @ts-ignore
		link.sub = undefined;
		link.prevSubOrUpdate = undefined;
		link.nextSub = undefined;
		link.nextDep = undefined;

		link.prevPropagateOrNextReleased = pool;
		pool = link;

		if (dep.subs === undefined && 'deps' in dep) {
			Subscriber.clearTrack(dep);
		}
	}
}

export namespace Dependency {

	const system = System;

	export function linkSubscriber(dep: Dependency) {
		if (system.activeSubsDepth === 0) {
			return;
		}
		const sub = system.activeSub!;
		const subVersion = sub.versionOrDirtyLevel;
		if (dep.subVersion === subVersion) {
			return;
		}
		dep.subVersion = subVersion;

		const depsTail = sub.depsTail;
		const old = depsTail !== undefined
			? depsTail.nextDep
			: sub.deps;

		if (old === undefined || old.dep !== dep) {
			const newLink = Link.get(dep, sub);
			if (old !== undefined) {
				newLink.nextDep = old;
			}
			if (depsTail === undefined) {
				sub.depsTail = sub.deps = newLink;
			} else {
				sub.depsTail = depsTail.nextDep = newLink;
			}
			if (dep.subs === undefined) {
				dep.subs = newLink;
				dep.subsTail = newLink;
			} else {
				const oldTail = dep.subsTail!;
				newLink.prevSubOrUpdate = oldTail;
				oldTail.nextSub = newLink;
				dep.subsTail = newLink;
			}
		} else {
			sub.depsTail = old;
		}
	}

	/**
	 * @deprecated TODO: Reuse linkSubscriber without performance regression
	 */
	export function linkSubscriberScope(dep: Dependency) {
		if (system.activeSubScope === undefined) {
			return;
		}
		const sub = system.activeSubScope!;
		const subVersion = sub.versionOrDirtyLevel;
		if (dep.subVersion === subVersion) {
			return;
		}
		dep.subVersion = subVersion;

		const depsTail = sub.depsTail;
		const old = depsTail !== undefined
			? depsTail.nextDep
			: sub.deps;

		if (old === undefined || old.dep !== dep) {
			const newLink = Link.get(dep, sub);
			if (old !== undefined) {
				newLink.nextDep = old;
			}
			if (depsTail === undefined) {
				sub.depsTail = sub.deps = newLink;
			} else {
				sub.depsTail = depsTail.nextDep = newLink;
			}
			if (dep.subs === undefined) {
				dep.subs = newLink;
				dep.subsTail = newLink;
			} else {
				const oldTail = dep.subsTail!;
				newLink.prevSubOrUpdate = oldTail;
				oldTail.nextSub = newLink;
				dep.subsTail = newLink;
			}
		} else {
			sub.depsTail = old;
		}
	}

	export function propagate(dep: Dependency) {
		let link = dep.subs;
		let dirtyLevel = DirtyLevels.Dirty;
		let depth = 0;

		top: while (true) {

			while (link !== undefined) {
				const sub = link.sub;
				const subDirtyLevel = sub.versionOrDirtyLevel;

				if (subDirtyLevel < dirtyLevel) {
					sub.versionOrDirtyLevel = dirtyLevel;
				}

				if (subDirtyLevel === DirtyLevels.NotDirty) {

					if ('subs' in sub) {
						sub.deps!.prevPropagateOrNextReleased = link;
						dep = sub;
						link = sub.subs;
						dirtyLevel = DirtyLevels.MaybeDirty;
						depth++;

						continue top;
					}

					if ('notify' in sub) {
						const queuedEffectsTail = system.queuedEffectsTail;

						if (queuedEffectsTail !== undefined) {
							queuedEffectsTail.nextNotify = sub;
							system.queuedEffectsTail = sub;
						} else {
							system.queuedEffectsTail = sub;
							system.queuedEffects = sub;
						}
					}
				}

				link = link.nextSub;
			}

			const depDeps = (dep as Dependency & Subscriber).deps;
			if (depDeps !== undefined) {

				const prevLink = depDeps.prevPropagateOrNextReleased;

				if (prevLink !== undefined) {
					depDeps.prevPropagateOrNextReleased = undefined;
					dep = prevLink.dep;
					link = prevLink.nextSub;
					depth--;

					if (depth === 0) {
						dirtyLevel = DirtyLevels.Dirty;
					}

					const prevSub = prevLink.sub;

					if ('notify' in prevSub) {
						const queuedEffectsTail = system.queuedEffectsTail;

						if (queuedEffectsTail !== undefined) {
							queuedEffectsTail.nextNotify = prevSub;
							system.queuedEffectsTail = prevSub;
						} else {
							system.queuedEffectsTail = prevSub;
							system.queuedEffects = prevSub;
						}
					}

					continue;
				}
			}

			break;
		}
	}
}

export namespace Subscriber {

	const system = System;

	export function resolveMaybeDirty(sub: Dependency & Subscriber) {
		let link = sub.deps;

		top: while (true) {

			while (link !== undefined) {
				const dep = link.dep as Dependency | Dependency & Subscriber;

				if ('deps' in dep) {
					const depDirtyLevel = dep.versionOrDirtyLevel;

					if (depDirtyLevel === DirtyLevels.MaybeDirty) {
						dep.subs!.prevSubOrUpdate = link;
						sub = dep;
						link = dep.deps;

						continue top;
					} else if (depDirtyLevel === DirtyLevels.Dirty) {
						dep.run!();

						if ((sub.versionOrDirtyLevel as DirtyLevels) === DirtyLevels.Dirty) {
							break;
						}
					}
				}

				link = link.nextDep;
			}

			const dirtyLevel = sub.versionOrDirtyLevel;

			if (dirtyLevel === DirtyLevels.MaybeDirty) {
				sub.versionOrDirtyLevel = DirtyLevels.NotDirty;
			}

			const subSubs = (sub as Dependency & Subscriber).subs;
			if (subSubs !== undefined) {

				const prevLink = subSubs.prevSubOrUpdate;

				if (prevLink !== undefined) {
					if (dirtyLevel === DirtyLevels.Dirty) {
						sub.run!();
					}

					subSubs.prevSubOrUpdate = undefined;
					sub = prevLink.sub as Dependency & Subscriber;
					link = prevLink.nextDep;

					continue;
				}
			}

			break;
		}
	}

	export function startTrack(sub: Subscriber) {
		const lastActiveSub = system.activeSub;
		system.activeSub = sub;
		system.activeSubsDepth++;
		preTrack(sub);
		return lastActiveSub;
	}

	export function endTrack(sub: Subscriber, lastActiveSub: Subscriber | undefined) {
		postTrack(sub);
		system.activeSubsDepth--;
		system.activeSub = lastActiveSub;
	}

	export function startScopeTrack(sub: Subscriber) {
		const lastActiveSub = system.activeSubScope;
		system.activeSubScope = sub;
		preTrack(sub);
		return lastActiveSub;
	}

	export function endScopeTrack(sub: Subscriber, lastActiveSub: Subscriber | undefined) {
		postTrack(sub);
		system.activeSubScope = lastActiveSub;
	}

	export function clearTrack(sub: Subscriber) {
		preTrack(sub);
		postTrack(sub);
	}

	function preTrack(sub: Subscriber) {
		sub.depsTail = undefined;
		sub.versionOrDirtyLevel = system.subVersion++;
	}

	function postTrack(sub: Subscriber) {
		if (sub.depsTail !== undefined) {
			Link.releaseDeps(sub.depsTail);
		} else if (sub.deps !== undefined) {
			Link.releaseDeps(sub.deps);
			Link.release(sub.deps);
			sub.deps = undefined;
		}
		sub.versionOrDirtyLevel = DirtyLevels.NotDirty;
	}
}
