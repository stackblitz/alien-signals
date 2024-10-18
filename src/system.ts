export interface IEffectScope extends Subscriber {
	nextNotify: IEffectScope | undefined;
	notify(): void;
}

export interface IEffect extends Dependency, IEffectScope { }

export interface IComputed extends Dependency, Subscriber {
	update(): void;
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
}

export interface Link {
	dep: Dependency | IComputed | IEffect;
	sub: IComputed | IEffect | IEffectScope;
	prevSubOrUpdate: Link | undefined;
	nextSub: Link | undefined;
	nextDep: Link | undefined;
	queuedPropagateOrNextReleased: Link | undefined;
}

export const enum DirtyLevels {
	None,
	SideEffectsOnly,
	MaybeDirty,
	Dirty,
	Released,
}

export namespace System {

	export let activeSub: Link['sub'] | undefined = undefined;
	export let activeEffectScope: IEffectScope | undefined = undefined;
	export let activeSubVersion = -1;
	export let activeEffectScopeVersion = -1;
	export let batchDepth = 0;
	export let lastSubVersion = DirtyLevels.Released + 1;
	export let queuedEffects: IEffectScope | undefined = undefined;
	export let queuedEffectsTail: IEffectScope | undefined = undefined;

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

	export let pool: Link | undefined = undefined;

	export function get(dep: Link['dep'], sub: Link['sub']): Link {
		if (pool !== undefined) {
			const link = pool;
			pool = link.queuedPropagateOrNextReleased;
			link.queuedPropagateOrNextReleased = undefined;
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
				queuedPropagateOrNextReleased: undefined,
			};
		}
	}
}

export namespace Dependency {

	const system = System;

	export let propagate = fastPropagate;

	export function setPropagationMode(mode: 'strict' | 'fast') {
		propagate = mode === 'strict' ? strictPropagate : fastPropagate;
	}

	export function linkSubscriber(dep: Link['dep'], sub: Link['sub']) {
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
				sub.deps = newLink;
			} else {
				depsTail.nextDep = newLink;
			}

			if (dep.subs === undefined) {
				dep.subs = newLink;
			} else {
				const oldTail = dep.subsTail!;
				newLink.prevSubOrUpdate = oldTail;
				oldTail.nextSub = newLink;
			}

			sub.depsTail = newLink;
			dep.subsTail = newLink;
		} else {
			sub.depsTail = old;
		}
	}

	export function strictPropagate(subs: Link) {
		let link: Link | undefined = subs;
		let dep = subs.dep;
		let dirtyLevel = DirtyLevels.Dirty;
		let remainingQuantity = 0;

		top: do {
			while (link !== undefined) {
				const sub: Link['sub'] = link.sub;
				const subDirtyLevel = sub.versionOrDirtyLevel;

				if (subDirtyLevel < dirtyLevel) {
					sub.versionOrDirtyLevel = dirtyLevel;
				}

				if (subDirtyLevel === DirtyLevels.None) {
					const subIsEffect = 'notify' in sub;

					if ('subs' in sub && sub.subs !== undefined) {
						sub.deps!.queuedPropagateOrNextReleased = link;
						dep = sub;
						link = sub.subs;
						if (subIsEffect) {
							dirtyLevel = DirtyLevels.SideEffectsOnly;
						} else {
							dirtyLevel = DirtyLevels.MaybeDirty;
						}
						remainingQuantity++;

						continue top;
					} else if (subIsEffect) {
						const queuedEffectsTail = system.queuedEffectsTail;
						if (queuedEffectsTail !== undefined) {
							queuedEffectsTail.nextNotify = sub;
						} else {
							system.queuedEffects = sub;
						}
						system.queuedEffectsTail = sub;
					}
				}

				link = link.nextSub;
			}

			if (remainingQuantity > 0) {
				const depDeps = (dep as IComputed | IEffect).deps!;
				const prevLink = depDeps.queuedPropagateOrNextReleased!;

				depDeps.queuedPropagateOrNextReleased = undefined;
				dep = prevLink.dep;
				link = prevLink.nextSub;
				remainingQuantity--;

				if (remainingQuantity === 0) {
					dirtyLevel = DirtyLevels.Dirty;
				} else if ('notify' in dep) {
					dirtyLevel = DirtyLevels.SideEffectsOnly;
				} else {
					dirtyLevel = DirtyLevels.MaybeDirty;
				}

				const prevSub = prevLink.sub;

				if ('notify' in prevSub) {
					const queuedEffectsTail = system.queuedEffectsTail;
					if (queuedEffectsTail !== undefined) {
						queuedEffectsTail.nextNotify = prevSub;
					} else {
						system.queuedEffects = prevSub;
					}
					system.queuedEffectsTail = prevSub;
				}

				continue;
			}

			break;
		} while (true);
	}

	/**
	 * @example Original
		export function fastPropagate(dep: Dependency, dirtyLevel = DirtyLevels.Dirty) {
			let link = dep.subs;

			while (link !== undefined) {
				const sub = link.sub;
				const subDirtyLevel = sub.versionOrDirtyLevel;

				if (subDirtyLevel < dirtyLevel) {
					sub.versionOrDirtyLevel = dirtyLevel;
				}

				if (subDirtyLevel === DirtyLevels.None) {
					if ('notify' in sub) {
						const queuedEffectsTail = system.queuedEffectsTail;

						if (queuedEffectsTail !== undefined) {
							queuedEffectsTail.nextNotify = sub;
							system.queuedEffectsTail = sub;
						} else {
							system.queuedEffectsTail = sub;
							system.queuedEffects = sub;
						}
					} else if ('subs' in sub) {
						fastPropagate(sub, DirtyLevels.MaybeDirty);
					}
				}

				link = link.nextSub;
			}
		}
	 */
	export function fastPropagate(subs: Link) {
		let subsHead = subs;
		let dirtyLevel = DirtyLevels.Dirty;
		let lastSubs = subsHead;
		let link = subsHead;
		let remainingQuantity = 0;

		do {
			const sub = link.sub;
			const subDirtyLevel = sub.versionOrDirtyLevel;

			if (subDirtyLevel < dirtyLevel) {
				sub.versionOrDirtyLevel = dirtyLevel;
			}

			if (subDirtyLevel === DirtyLevels.None) {

				if ('notify' in sub) {
					const queuedEffectsTail = system.queuedEffectsTail;

					if (queuedEffectsTail !== undefined) {
						queuedEffectsTail.nextNotify = sub;
						system.queuedEffectsTail = sub;
					} else {
						system.queuedEffectsTail = sub;
						system.queuedEffects = sub;
					}
				} else if ('subs' in sub) {
					const subSubs = sub.subs;

					if (subSubs !== undefined) {
						lastSubs.queuedPropagateOrNextReleased = subSubs;
						lastSubs = subSubs;
						remainingQuantity++;
					}
				}
			}

			const nextSub = link.nextSub;
			if (nextSub === undefined) {
				if (remainingQuantity > 0) {
					const nextPropagate = subsHead.queuedPropagateOrNextReleased!;
					subsHead.queuedPropagateOrNextReleased = undefined;
					subsHead = nextPropagate;
					link = subsHead;

					dirtyLevel = DirtyLevels.MaybeDirty;
					remainingQuantity--;
					continue;
				}
				break;
			}

			link = nextSub;
		} while (true);
	}
}

export namespace Subscriber {

	const system = System;

	export function runInnerEffects(sub: IEffectScope) {
		let link = sub.deps;
		while (link !== undefined) {
			const dep = link.dep;
			if ('notify' in dep) {
				dep.notify();
			}
			link = link.nextDep;
		}
	}

	export function resolveMaybeDirty(sub: IComputed | IEffect, depth = 0) {
		let link = sub.deps;

		while (link !== undefined) {
			const dep = link.dep;
			if ('update' in dep) {
				const dirtyLevel = dep.versionOrDirtyLevel;

				if (dirtyLevel === DirtyLevels.MaybeDirty) {
					if (depth >= 4) {
						resolveMaybeDirtyNonRecursive(dep);
					} else {
						resolveMaybeDirty(dep, depth + 1);
					}
					if (dep.versionOrDirtyLevel === DirtyLevels.Dirty) {
						dep.update();
						if (sub.versionOrDirtyLevel === DirtyLevels.Dirty) {
							break;
						}
					}
				} else if (dirtyLevel === DirtyLevels.Dirty) {
					dep.update();
					if (sub.versionOrDirtyLevel === DirtyLevels.Dirty) {
						break;
					}
				}
			}
			link = link.nextDep;
		}

		if (sub.versionOrDirtyLevel === DirtyLevels.MaybeDirty) {
			sub.versionOrDirtyLevel = DirtyLevels.None;
		}
	}

	export function resolveMaybeDirtyNonRecursive(sub: IComputed | IEffect) {
		let link = sub.deps;
		let remaining = 0;

		do {
			if (link !== undefined) {
				const dep = link.dep;

				if ('update' in dep) {
					const depDirtyLevel = dep.versionOrDirtyLevel;

					if (depDirtyLevel === DirtyLevels.MaybeDirty) {
						dep.subs!.prevSubOrUpdate = link;
						sub = dep;
						link = dep.deps;
						remaining++;

						continue;
					} else if (depDirtyLevel === DirtyLevels.Dirty) {
						dep.update();

						if (sub.versionOrDirtyLevel === DirtyLevels.Dirty) {
							if (remaining > 0) {
								const subSubs = sub.subs!;
								const prevLink = subSubs.prevSubOrUpdate!;
								(sub as IComputed).update();
								subSubs.prevSubOrUpdate = undefined;
								sub = prevLink.sub as IComputed | IEffect;
								link = prevLink.nextDep;
								remaining--;
								continue;
							}

							break;
						}
					}
				}

				link = link.nextDep;
				continue;
			}

			const dirtyLevel = sub.versionOrDirtyLevel;

			if (dirtyLevel === DirtyLevels.MaybeDirty) {
				sub.versionOrDirtyLevel = DirtyLevels.None;
				if (remaining > 0) {
					const subSubs = sub.subs!;
					const prevLink = subSubs.prevSubOrUpdate!;
					subSubs.prevSubOrUpdate = undefined;
					sub = prevLink.sub as IComputed | IEffect;
					link = prevLink.nextDep;
					remaining--;
					continue;
				}
			} else if (remaining > 0) {
				const subSubs = sub.subs!;
				const prevLink = subSubs.prevSubOrUpdate!;
				if (dirtyLevel === DirtyLevels.Dirty) {
					(sub as IComputed).update();
				}
				subSubs.prevSubOrUpdate = undefined;
				sub = prevLink.sub as IComputed | IEffect;
				link = prevLink.nextDep;
				remaining--;
				continue;
			}

			break;
		} while (true);
	}

	export function startTrackDependencies(sub: Link['sub']) {
		const newVersion = system.lastSubVersion + 1;

		sub.depsTail = undefined;
		sub.versionOrDirtyLevel = newVersion;

		const prevSub = system.activeSub;
		system.activeSub = sub;
		system.activeSubVersion = newVersion;
		system.lastSubVersion = newVersion;
		return prevSub;
	}

	export function endTrackDependencies(sub: Link['sub'], prevSub: Link['sub'] | undefined) {
		if (prevSub !== undefined) {
			system.activeSub = prevSub!;
			system.activeSubVersion = prevSub!.versionOrDirtyLevel;
		} else {
			system.activeSub = undefined;
			system.activeSubVersion = -1;
		}

		const depsTail = sub.depsTail;
		if (depsTail !== undefined) {
			if (depsTail.nextDep !== undefined) {
				clearTrack(depsTail.nextDep);
				depsTail.nextDep = undefined;
			}
		} else if (sub.deps !== undefined) {
			clearTrack(sub.deps);
			sub.deps = undefined;
		}
		sub.versionOrDirtyLevel = DirtyLevels.None;
	}

	export function clearTrack(link: Link) {
		do {
			const nextDep = link.nextDep;
			const dep = link.dep;
			const nextSub = link.nextSub;
			const prevSub = link.prevSubOrUpdate;

			if (nextSub !== undefined) {
				nextSub.prevSubOrUpdate = prevSub;
			}
			if (prevSub !== undefined) {
				prevSub.nextSub = nextSub;
			}

			if (nextSub === undefined) {
				dep.subsTail = prevSub;
			}
			if (prevSub === undefined) {
				dep.subs = nextSub;
			}

			// @ts-ignore
			link.dep = undefined;
			// @ts-ignore
			link.sub = undefined;
			link.prevSubOrUpdate = undefined;
			link.nextSub = undefined;
			link.nextDep = undefined;

			link.queuedPropagateOrNextReleased = Link.pool;
			Link.pool = link;

			if (dep.subs === undefined && 'deps' in dep) {
				dep.versionOrDirtyLevel = DirtyLevels.Released;
				if (dep.deps !== undefined) {
					link = dep.deps;
					dep.depsTail!.nextDep = nextDep;
					dep.deps = undefined;
					dep.depsTail = undefined;
					continue;
				}
			}

			link = nextDep!;
		} while (link !== undefined);
	}

	export function startTrackEffects(sub: IEffectScope) {
		const newVersion = system.lastSubVersion + 1;

		sub.depsTail = undefined;
		sub.versionOrDirtyLevel = newVersion;

		const prevSub = system.activeEffectScope;
		system.activeEffectScope = sub;
		system.activeEffectScopeVersion = newVersion;
		system.lastSubVersion = newVersion;
		return prevSub;
	}

	export function endTrackEffects(sub: IEffectScope, prevSub: IEffectScope | undefined) {
		if (prevSub !== undefined) {
			system.activeEffectScope = prevSub!;
			system.activeEffectScopeVersion = prevSub!.versionOrDirtyLevel;
		} else {
			system.activeEffectScope = undefined;
			system.activeEffectScopeVersion = -1;
		}

		const depsTail = sub.depsTail;
		if (depsTail !== undefined) {
			if (depsTail.nextDep !== undefined) {
				clearTrack(depsTail.nextDep);
				depsTail.nextDep = undefined;
			}
		} else if (sub.deps !== undefined) {
			clearTrack(sub.deps);
			sub.deps = undefined;
		}
		sub.versionOrDirtyLevel = DirtyLevels.None;
	}
}
