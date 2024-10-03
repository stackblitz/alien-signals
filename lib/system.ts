export interface IEffect {
	nextNotify: IEffect | undefined;
	notify(): void;
}

export interface Dependency {
	subs: Link | undefined;
	subsTail: Link | undefined;
	subVersion: number;
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
	prevUpdate: Link | undefined;
	run(): void;
}

export interface Link {
	dep: Dependency;
	sub: Subscriber & ({} | IEffect | Dependency);
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	nextDep: Link | undefined;
	nextPropagateOrReleased: Link | undefined;
}

export const enum DirtyLevels {
	NotDirty,
	QueryingDirty,
	MaybeDirty,
	Dirty,
}

export namespace System {

	export let activeSub: Subscriber | undefined = undefined;
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
			}
			else {
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
			pool = link.nextPropagateOrReleased;
			link.nextPropagateOrReleased = undefined;
			link.dep = dep;
			link.sub = sub;
			return link;
		} else {
			return {
				dep,
				sub,
				prevSub: undefined,
				nextSub: undefined,
				nextDep: undefined,
				nextPropagateOrReleased: undefined,
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
		const nextSub = link.nextSub;
		const prevSub = link.prevSub;

		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
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
		link.prevSub = undefined;
		link.nextSub = undefined;
		link.nextDep = undefined;

		link.nextPropagateOrReleased = pool;
		pool = link;
	}
}

export namespace Dependency {

	const system = System;

	export function link(dep: Dependency) {
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
				const nextDep = old.nextDep;
				Link.release(old);
				newLink.nextDep = nextDep;
			}
			if (depsTail === undefined) {
				sub.depsTail = sub.deps = newLink;
			}
			else {
				sub.depsTail = depsTail.nextDep = newLink;
			}
			if (dep.subs === undefined) {
				dep.subs = newLink;
				dep.subsTail = newLink;
			}
			else {
				const oldTail = dep.subsTail!;
				newLink.prevSub = oldTail;
				oldTail.nextSub = newLink;
				dep.subsTail = newLink;
			}
		}
		else {
			sub.depsTail = old;
		}
	}

	export function propagate(dep: Dependency) {
		let dirtyLevel = DirtyLevels.Dirty;
		let currentSubs = dep.subs;
		let lastSubs = currentSubs!;

		while (currentSubs !== undefined) {
			let subLink = currentSubs;

			while (true) {
				const sub = subLink.sub;
				const subDirtyLevel = sub.versionOrDirtyLevel;

				if (subDirtyLevel === DirtyLevels.NotDirty) {

					if ('subs' in sub) {
						const subSubs = sub.subs;

						if (subSubs !== undefined) {
							lastSubs.nextPropagateOrReleased = subSubs;
							lastSubs = subSubs;
						}
					}
					if ('notify' in sub) {
						const queuedEffectsTail = system.queuedEffectsTail;

						if (queuedEffectsTail !== undefined) {
							queuedEffectsTail.nextNotify = sub;
							system.queuedEffectsTail = sub;
						}
						else {
							system.queuedEffectsTail = sub;
							system.queuedEffects = sub;
						}
					}
				}

				if (subDirtyLevel < dirtyLevel) {
					sub.versionOrDirtyLevel = dirtyLevel;
				}

				const nextSub = subLink.nextSub;
				if (nextSub === undefined) {
					break;
				}
				subLink = nextSub;
			}

			dirtyLevel = DirtyLevels.MaybeDirty;
			const nextPropagate = currentSubs.nextPropagateOrReleased;
			currentSubs.nextPropagateOrReleased = undefined;
			currentSubs = nextPropagate;
		}
	}
}

export namespace Subscriber {

	const system = System;

	export function confirmDirtyLevel(sub: Subscriber) {
		let link = sub.deps;

		top: while (true) {

			while (link !== undefined) {
				const dep = link.dep as Dependency | Dependency & Subscriber;

				if ('deps' in dep) {
					const depDirtyLevel = dep.versionOrDirtyLevel;

					if (depDirtyLevel === DirtyLevels.MaybeDirty) {
						dep.prevUpdate = link;
						sub = dep;
						link = dep.deps;

						continue top;
					}
					else if (depDirtyLevel === DirtyLevels.Dirty) {
						dep.run();

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

			const prevLink = sub.prevUpdate;

			if (prevLink !== undefined) {
				if (dirtyLevel === DirtyLevels.Dirty) {
					sub.run();
				}

				sub.prevUpdate = undefined;
				sub = prevLink.sub;
				link = prevLink.nextDep;

				continue top;
			}

			break;
		}
	}

	export function startTrack(sub: Subscriber) {
		const lastActiveSub = system.activeSub;
		system.activeSub = sub;
		system.activeSubsDepth++;
		Subscriber.preTrack(sub);
		return lastActiveSub;
	}

	export function endTrack(sub: Subscriber, lastActiveSub: Subscriber | undefined) {
		Subscriber.postTrack(sub);
		system.activeSubsDepth--;
		system.activeSub = lastActiveSub;
	}

	export function preTrack(sub: Subscriber) {
		sub.depsTail = undefined;
		sub.versionOrDirtyLevel = system.subVersion++;
	}

	export function postTrack(sub: Subscriber) {
		if (sub.depsTail !== undefined) {
			Link.releaseDeps(sub.depsTail);
		}
		else if (sub.deps !== undefined) {
			Link.releaseDeps(sub.deps);
			Link.release(sub.deps);
			sub.deps = undefined;
		}
		sub.versionOrDirtyLevel = DirtyLevels.NotDirty;
	}
}
