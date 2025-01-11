import { Computed } from '../computed.js';
import { endTrack, link, shallowPropagate, startTrack } from '../internal.js';
import { Dependency, SubscriberFlags } from '../system.js';
import { asyncCheckDirty } from './asyncSystem.js';

export function asyncComputed<T>(getter: (cachedValue?: T) => AsyncGenerator<Dependency, T>): AsyncComputed<T> {
	return new AsyncComputed<T>(getter);
}

export async function updateAsyncComputed(computed: Computed | AsyncComputed): Promise<boolean> {
	try {
		startTrack(computed);
		const oldValue = computed.currentValue;
		const generator = computed.getter(oldValue);
		let current = await generator.next();
		while (!current.done) {
			const dep = current.value;
			link(dep, computed);
			current = await generator.next();
		}
		const newValue = await current.value;
		if (oldValue !== newValue) {
			computed.currentValue = newValue;
			return true;
		}
		return false;
	} finally {
		endTrack(computed);
	}
}

export class AsyncComputed<T = any> extends Computed {

	async get(): Promise<T> {
		const flags = this.flags;
		if (flags & SubscriberFlags.Dirty) {
			if (await updateAsyncComputed(this)) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		} else if (flags & SubscriberFlags.ToCheckDirty) {
			if (await asyncCheckDirty(this.deps!)) {
				if (await updateAsyncComputed(this)) {
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
}
