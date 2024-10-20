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
	linkedTrackId: number;
}

export interface Subscriber {
	trackId: number;
	canPropagate: boolean;
	dirtyLevel: DirtyLevels;
	deps: Link | undefined;
	depsTail: Link | undefined;
}

export interface Link {
	dep: Dependency | IComputed | IEffect;
	sub: IComputed | IEffect | IEffectScope;
	trackId: number;
	// Also used as prev update
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	// Also used as prev propagate and next released
	nextDep: Link | undefined;
}

export const enum DirtyLevels {
	None,
	SideEffectsOnly,
	MaybeDirty,
	Dirty,
	Released,
}

export namespace System {

	export let activeSub: IComputed | IEffect | undefined = undefined;
	export let activeEffectScope: IEffectScope | undefined = undefined;
	export let activeTrackId = 0;
	export let activeEffectScopeTrackId = 0;
	export let batchDepth = 0;
	export let lastTrackId = 0;
	export let queuedEffects: IEffectScope | undefined = undefined;
	export let queuedEffectsTail: IEffectScope | undefined = undefined;

	export function startBatch() {
		batchDepth++;
	}

	export function endBatch() {
		batchDepth--;
		if (batchDepth === 0) {
			while (queuedEffects !== undefined) {
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
}

export namespace Link {
	export let pool: Link | undefined = undefined;
}

export namespace Dependency {

	const system = System;

	export function linkSubscriber(dep: Link['dep'], sub: Link['sub']) {
		const depsTail = sub.depsTail;
		const old = depsTail !== undefined
			? depsTail.nextDep
			: sub.deps;

		if (old === undefined || old.dep !== dep) {
			let newLink: Link;

			if (Link.pool !== undefined) {
				newLink = Link.pool;
				Link.pool = newLink.nextDep;
				newLink.nextDep = old;
				newLink.dep = dep;
				newLink.sub = sub;
				newLink.trackId = sub.trackId;
			} else {
				newLink = {
					dep,
					sub,
					trackId: sub.trackId,
					nextDep: old,
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
		} else {
			old.trackId = sub.trackId;
			sub.depsTail = old;
		}
	}

	export function propagate(subs: Link) {
		let link: Link | undefined = subs;
		let dep = subs.dep;
		let dirtyLevel = DirtyLevels.Dirty;
		let remainingQuantity = 0;

		do {
			if (link !== undefined) {
				const sub: Link['sub'] = link.sub;

				if (sub.trackId > 0) {
					if (sub.trackId === link.trackId) {
						const subDirtyLevel = sub.dirtyLevel;
						if (subDirtyLevel < dirtyLevel) {
							sub.dirtyLevel = dirtyLevel;
							if (subDirtyLevel === DirtyLevels.None) {
								sub.canPropagate = true;
							}
						}
					}
				} else if (sub.trackId === -link.trackId) {

					const subDirtyLevel = sub.dirtyLevel;
					const notDirty = subDirtyLevel === DirtyLevels.None;

					if (subDirtyLevel < dirtyLevel) {
						sub.dirtyLevel = dirtyLevel;
					}

					if (notDirty || sub.canPropagate) {
						if (!notDirty) {
							sub.canPropagate = false;
						}

						const subIsEffect = 'notify' in sub;

						if ('subs' in sub && sub.subs !== undefined) {
							sub.depsTail!.nextDep = link;
							dep = sub;
							link = sub.subs;
							if (subIsEffect) {
								dirtyLevel = DirtyLevels.SideEffectsOnly;
							} else {
								dirtyLevel = DirtyLevels.MaybeDirty;
							}
							remainingQuantity++;

							continue;
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
				}

				link = link.nextSub;
				continue;
			}

			if (remainingQuantity !== 0) {
				const depsTail = (dep as IComputed | IEffect).depsTail!;
				const prevLink = depsTail.nextDep!;
				const prevSub = prevLink.sub;

				depsTail.nextDep = undefined;
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
}

export namespace Subscriber {

	const system = System;

	export function runInnerEffects(link: Link | undefined) {
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
				const dirtyLevel = dep.dirtyLevel;

				if (dirtyLevel === DirtyLevels.MaybeDirty) {
					if (depth >= 4) {
						resolveMaybeDirtyNonRecursive(dep);
					} else {
						resolveMaybeDirty(dep, depth + 1);
					}
					if (dep.dirtyLevel === DirtyLevels.Dirty) {
						dep.update();
						if (sub.dirtyLevel === DirtyLevels.Dirty) {
							break;
						}
					}
				} else if (dirtyLevel === DirtyLevels.Dirty) {
					dep.update();
					if (sub.dirtyLevel === DirtyLevels.Dirty) {
						break;
					}
				}
			}
			link = link.nextDep;
		}

		if (sub.dirtyLevel === DirtyLevels.MaybeDirty) {
			sub.dirtyLevel = DirtyLevels.None;
		}
	}

	export function resolveMaybeDirtyNonRecursive(sub: IComputed | IEffect) {
		let link = sub.deps;
		let remaining = 0;

		do {
			if (link !== undefined) {
				const dep = link.dep;

				if ('update' in dep) {
					const depDirtyLevel = dep.dirtyLevel;

					if (depDirtyLevel === DirtyLevels.MaybeDirty) {
						dep.subs!.prevSub = link;
						sub = dep;
						link = dep.deps;
						remaining++;

						continue;
					} else if (depDirtyLevel === DirtyLevels.Dirty) {
						dep.update();

						if (sub.dirtyLevel === DirtyLevels.Dirty) {
							if (remaining !== 0) {
								const subSubs = sub.subs!;
								const prevLink = subSubs.prevSub!;
								(sub as IComputed).update();
								subSubs.prevSub = undefined;
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

			const dirtyLevel = sub.dirtyLevel;

			if (dirtyLevel === DirtyLevels.MaybeDirty) {
				sub.dirtyLevel = DirtyLevels.None;
				if (remaining !== 0) {
					const subSubs = sub.subs!;
					const prevLink = subSubs.prevSub!;
					subSubs.prevSub = undefined;
					sub = prevLink.sub as IComputed | IEffect;
					link = prevLink.nextDep;
					remaining--;
					continue;
				}
			} else if (remaining !== 0) {
				if (dirtyLevel === DirtyLevels.Dirty) {
					(sub as IComputed).update();
				}
				const subSubs = sub.subs!;
				const prevLink = subSubs.prevSub!;
				subSubs.prevSub = undefined;
				sub = prevLink.sub as IComputed | IEffect;
				link = prevLink.nextDep;
				remaining--;
				continue;
			}

			break;
		} while (true);
	}

	export function startTrackDependencies(sub: IComputed | IEffect) {
		const newVersion = system.lastTrackId + 1;
		const prevSub = system.activeSub;

		system.activeSub = sub;
		system.activeTrackId = newVersion;
		system.lastTrackId = newVersion;

		sub.depsTail = undefined;
		sub.trackId = newVersion;
		sub.dirtyLevel = DirtyLevels.None;

		return prevSub;
	}

	export function endTrackDependencies(sub: IComputed | IEffect, prevSub: IComputed | IEffect | undefined) {
		if (prevSub !== undefined) {
			system.activeSub = prevSub;
			system.activeTrackId = prevSub.trackId;
		} else {
			system.activeSub = undefined;
			system.activeTrackId = 0;
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
		sub.trackId = -sub.trackId;
	}

	export function clearTrack(link: Link) {
		do {
			const nextDep = link.nextDep;
			const dep = link.dep;
			const nextSub = link.nextSub;
			const prevSub = link.prevSub;

			if (nextSub !== undefined) {
				nextSub.prevSub = prevSub;
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
			link.prevSub = undefined;
			link.nextSub = undefined;
			link.nextDep = Link.pool;
			Link.pool = link;

			if (dep.subs === undefined && 'deps' in dep) {
				dep.dirtyLevel = DirtyLevels.Released;
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
		const newVersion = system.lastTrackId + 1;
		const prevSub = system.activeEffectScope;

		system.activeEffectScope = sub;
		system.activeEffectScopeTrackId = newVersion;
		system.lastTrackId = newVersion;

		sub.depsTail = undefined;
		sub.trackId = newVersion;
		sub.dirtyLevel = DirtyLevels.None;

		return prevSub;
	}

	export function endTrackEffects(sub: IEffectScope, prevSub: IEffectScope | undefined) {
		if (prevSub !== undefined) {
			system.activeEffectScope = prevSub;
			system.activeEffectScopeTrackId = prevSub.trackId;
		} else {
			system.activeEffectScope = undefined;
			system.activeEffectScopeTrackId = 0;
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
		sub.trackId = -sub.trackId;
	}
}
