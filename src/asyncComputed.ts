import { Computed } from './computed.js';
import { nextTrackId } from './effect.js';
import { checkDirty, Dependency, endTrack, link, shallowPropagate, startTrack, SubscriberFlags } from './system.js';

export function asyncComputed<T>(getter: (cachedValue?: T) => AsyncGenerator<Dependency, T>): AsyncComputed<T> {
	return new AsyncComputed<T>(getter);
}

export class AsyncComputed<T = any> extends Computed {

	async get(): Promise<T> {
		const flags = this.flags;
		if (flags & SubscriberFlags.Dirty) {
			if (await this.update()) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		} else if (flags & SubscriberFlags.ToCheckDirty) {
			if (checkDirty(this.deps!)) {
				if (await this.update()) {
					const subs = this.subs;
					if (subs !== undefined) {
						shallowPropagate(subs);
					}
				}
			} else {
				this.flags = flags & ~SubscriberFlags.ToCheckDirty;
			}
		}
		return this.currentValue!;
	}

	// @ts-expect-error
	async update(): Promise<boolean> {
		try {
			startTrack(this);
			const trackId = nextTrackId();
			const oldValue = this.currentValue;
			const generator = this.getter(oldValue);
			let current = await generator.next();
			while (!current.done) {
				const dep = current.value;
				if (dep.lastTrackedId !== trackId) {
					dep.lastTrackedId = trackId;
					link(dep, this);
				}
				current = await generator.next();
			}
			const newValue = await current.value;
			if (oldValue !== newValue) {
				this.currentValue = newValue;
				return true;
			}
			return false;
		} finally {
			endTrack(this);
		}
	}
}
