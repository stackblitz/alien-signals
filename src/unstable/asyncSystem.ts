import { IComputed, ILink, shallowPropagate, SubscriberFlags } from "../system";

export async function asyncCheckDirty(link: ILink): Promise<boolean> {
	let stack = 0;
	let dirty: boolean;
	let nextDep: ILink | undefined;

	top: do {
		dirty = false;
		const dep = link.dep;
		if ('update' in dep) {
			const depFlags = dep.flags;
			if (depFlags & SubscriberFlags.Dirty) {
				if (await dep.update()) {
					const subs = dep.subs!;
					if (subs.nextSub !== undefined) {
						shallowPropagate(subs);
					}
					dirty = true;
				}
			} else if (depFlags & SubscriberFlags.ToCheckDirty) {
				const depSubs = dep.subs!;
				if (depSubs.nextSub !== undefined) {
					depSubs.prevSub = link;
				}
				link = dep.deps!;
				++stack;
				continue;
			}
		}
		if (dirty || (nextDep = link.nextDep) === undefined) {
			if (stack) {
				let sub = link.sub as IComputed;
				do {
					--stack;
					const subSubs = sub.subs!;
					let prevLink = subSubs.prevSub!;
					if (prevLink !== undefined) {
						subSubs.prevSub = undefined;
						if (dirty) {
							if (await sub.update()) {
								shallowPropagate(sub.subs!);
								sub = prevLink.sub as IComputed;
								continue;
							}
						} else {
							sub.flags &= ~SubscriberFlags.ToCheckDirty;
						}
					} else {
						if (dirty) {
							if (await sub.update()) {
								sub = subSubs.sub as IComputed;
								continue;
							}
						} else {
							sub.flags &= ~SubscriberFlags.ToCheckDirty;
						}
						prevLink = subSubs;
					}
					link = prevLink.nextDep!;
					if (link !== undefined) {
						continue top;
					}
					sub = prevLink.sub as IComputed;
					dirty = false;
				} while (stack);
			}
			return dirty;
		}
		link = nextDep;
	} while (true);
}
