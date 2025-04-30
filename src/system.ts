export interface Node {
	deps?: Link;
	depsTail?: Link;
	subs?: Link;
	subsTail?: Link;
	flags: Flags;
}

export interface Link {
	dep: Node;
	sub: Node;
	prevSub: Link | undefined;
	nextSub: Link | undefined;
	prevDep: Link | undefined;
	nextDep: Link | undefined;
}

interface OneWayLink<T> {
	target: T;
	linked: OneWayLink<T> | undefined;
}

export const enum Flags {
	None = 0,
	Mutable = 1 << 0,
	Watching = 1 << 1,
	RecursedCheck = 1 << 2,
	Recursed = 1 << 3,
	Dirty = 1 << 4,
	Pending = 1 << 5,
}

export function createReactiveSystem({
	update,
	notify,
	unwatched,
}: {
	update(sub: Node): boolean;
	notify(sub: Node): void;
	unwatched(sub: Node): void;
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

	function link(dep: Node, sub: Node): Link | undefined {
		const prevDep = sub.depsTail;
		if (prevDep !== undefined && prevDep.dep === dep) {
			return;
		}
		const nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
		if (nextDep !== undefined && nextDep.dep === dep) {
			sub.depsTail = nextDep;
			return;
		}
		const prevSub = dep.subsTail;
		if (prevSub !== undefined && prevSub.sub === sub && isValidLink(prevSub, sub)) {
			return;
		}
		const newLink
			= sub.depsTail
			= dep.subsTail
			= {
				dep,
				sub,
				prevDep,
				nextDep,
				prevSub,
				nextSub: undefined,
			};
		if (nextDep !== undefined) {
			nextDep.prevDep = newLink;
		}
		if (prevDep !== undefined) {
			prevDep.nextDep = newLink;
		} else {
			sub.deps = newLink;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = newLink;
		} else {
			dep.subs = newLink;
		}
		return newLink;
	}

	function unlink(link: Link, sub = link.sub): Link | undefined {
		const dep = link.dep;
		const prevDep = link.prevDep;
		const nextDep = link.nextDep;
		const nextSub = link.nextSub;
		const prevSub = link.prevSub;
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
		if (nextSub !== undefined) {
			nextSub.prevSub = prevSub;
		} else {
			dep.subsTail = prevSub;
		}
		if (prevSub !== undefined) {
			prevSub.nextSub = nextSub;
		} else if ((dep.subs = nextSub) === undefined) {
			unwatched(dep);
		}
		return nextDep;
	}

	function propagate(current: Link): void {
		let next = current.nextSub;
		let branchs: OneWayLink<Link | undefined> | undefined;
		let branchDepth = 0;

		top: do {
			const sub = current.sub;

			let flags = sub.flags;

			if (flags & (Flags.Mutable | Flags.Watching)) {
				if (!(flags & (Flags.RecursedCheck | Flags.Recursed | Flags.Dirty | Flags.Pending))) {
					sub.flags = flags | Flags.Pending;
				} else if (!(flags & (Flags.RecursedCheck | Flags.Recursed))) {
					flags = Flags.None;
				} else if (!(flags & Flags.RecursedCheck)) {
					sub.flags = (flags & ~Flags.Recursed) | Flags.Pending;
				} else if (isValidLink(current, sub)) {
					if (!(flags & (Flags.Dirty | Flags.Pending))) {
						sub.flags = flags | Flags.Recursed | Flags.Pending;
						flags &= Flags.Mutable;
					} else {
						flags = Flags.None;
					}
				} else {
					flags = Flags.None;
				}

				if (flags & Flags.Watching) {
					notify(sub);
				}

				if (flags & Flags.Mutable) {
					const subSubs = sub.subs;
					if (subSubs !== undefined) {
						current = subSubs;
						if (subSubs.nextSub !== undefined) {
							branchs = { target: next, linked: branchs };
							++branchDepth;
							next = current.nextSub;
						}
						continue;
					}
				}
			}

			if ((current = next!) !== undefined) {
				next = current.nextSub;
				continue;
			}

			while (branchDepth--) {
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

	function startTracking(sub: Node): void {
		sub.depsTail = undefined;
		sub.flags = (sub.flags & ~(Flags.Recursed | Flags.Dirty | Flags.Pending)) | Flags.RecursedCheck;
	}

	function endTracking(sub: Node): void {
		const depsTail = sub.depsTail;
		let toRemove = depsTail !== undefined ? depsTail.nextDep : sub.deps;
		while (toRemove !== undefined) {
			toRemove = unlink(toRemove, sub);
		}
		sub.flags &= ~Flags.RecursedCheck;
	}

	function checkDirty(current: Link): boolean {
		let prevLinks: OneWayLink<Link> | undefined;
		let checkDepth = 0;
		let dirty: boolean;

		top: do {
			dirty = false;
			const dep = current.dep;
			const depFlags = dep.flags;

			if (current.sub.flags & Flags.Dirty) {
				dirty = true;
			} else if ((depFlags & (Flags.Mutable | Flags.Dirty)) === (Flags.Mutable | Flags.Dirty)) {
				if (update(dep)) {
					const subs = dep.subs!;
					if (subs.nextSub !== undefined) {
						shallowPropagate(subs);
					}
					dirty = true;
				}
			} else if ((depFlags & (Flags.Mutable | Flags.Pending)) === (Flags.Mutable | Flags.Pending)) {
				if (current.nextSub !== undefined || current.prevSub !== undefined) {
					prevLinks = { target: current, linked: prevLinks };
				}
				current = dep.deps!;
				++checkDepth;
				continue;
			}

			if (!dirty && current.nextDep !== undefined) {
				current = current.nextDep;
				continue;
			}

			while (checkDepth) {
				--checkDepth;
				const sub = current.sub;
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
					sub.flags &= ~Flags.Pending;
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

	function shallowPropagate(link: Link): void {
		do {
			const sub = link.sub;
			const nextSub = link.nextSub;
			const subFlags = sub.flags;
			if ((subFlags & (Flags.Pending | Flags.Dirty)) === Flags.Pending) {
				sub.flags = subFlags | Flags.Dirty;
				if (subFlags & Flags.Watching) {
					notify(sub);
				}
			}
			link = nextSub!;
		} while (link !== undefined);
	}

	function isValidLink(checkLink: Link, sub: Node): boolean {
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
}
