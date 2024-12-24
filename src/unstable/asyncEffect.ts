import { Effect, nextTrackId } from '../effect.js';
import { Dependency, endTrack, link, startTrack, SubscriberFlags } from '../system.js';
import { asyncCheckDirty } from './asyncSystem.js';

export function asyncEffect<T>(fn: () => AsyncGenerator<Dependency, T>): AsyncEffect<T> {
	const e = new AsyncEffect(fn);
	e.run();
	return e;
}

export class AsyncEffect<T = any> extends Effect {

	async notify(): Promise<void> {
		let flags = this.flags;
		if (flags & SubscriberFlags.Dirty) {
			this.run();
			return;
		}
		if (flags & SubscriberFlags.ToCheckDirty) {
			if (await asyncCheckDirty(this.deps!)) {
				this.run();
				return;
			} else {
				this.flags = flags &= ~SubscriberFlags.ToCheckDirty;
			}
		}
		if (flags & SubscriberFlags.InnerEffectsPending) {
			this.flags = flags & ~SubscriberFlags.InnerEffectsPending;
			let link = this.deps!;
			do {
				const dep = link.dep;
				if ('notify' in dep) {
					dep.notify();
				}
				link = link.nextDep!;
			} while (link !== undefined);
		}
	}

	async run(): Promise<T> {
		try {
			startTrack(this);
			const trackId = nextTrackId();
			const generator = this.fn();
			let current = await generator.next();
			while (!current.done) {
				const dep = current.value;
				if (dep.lastTrackedId !== trackId) {
					dep.lastTrackedId = trackId;
					link(dep, this);
				}
				current = await generator.next();
			}
			return await current.value;
		} finally {
			endTrack(this);
		}
	}
}
