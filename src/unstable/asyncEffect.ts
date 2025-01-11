import { Effect, notifyEffect } from '../effect.js';
import { endTrack, isEffect, link, startTrack } from '../internal.js';
import { Dependency, SubscriberFlags } from '../system.js';
import { asyncCheckDirty } from './asyncSystem.js';

export function asyncEffect<T>(fn: () => AsyncGenerator<Dependency, T>): AsyncEffect<T> {
	const e = new AsyncEffect(fn);
	e.run();
	return e;
}

export async function notifyAsyncEffect(effect: AsyncEffect): Promise<void> {
	let flags = effect.flags;
	if (flags & SubscriberFlags.Dirty) {
		effect.run();
		return;
	}
	if (flags & SubscriberFlags.ToCheckDirty) {
		if (await asyncCheckDirty(effect.deps!)) {
			effect.run();
			return;
		} else {
			effect.flags = flags &= ~SubscriberFlags.ToCheckDirty;
		}
	}
	if (flags & SubscriberFlags.InnerEffectsPending) {
		effect.flags = flags & ~SubscriberFlags.InnerEffectsPending;
		let link = effect.deps!;
		do {
			const dep = link.dep;
			if ('flags' in dep && isEffect(dep)) {
				notifyEffect(dep);
			}
			link = link.nextDep!;
		} while (link !== undefined);
	}
}

export class AsyncEffect<T = any> extends Effect {

	async run(): Promise<T> {
		try {
			startTrack(this);
			const generator = this.fn();
			let current = await generator.next();
			while (!current.done) {
				const dep = current.value;
				link(dep, this);
				current = await generator.next();
			}
			return await current.value;
		} finally {
			endTrack(this);
		}
	}
}
