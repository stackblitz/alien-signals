import { createSystem, Dependency, Subscriber, SubscriberFlags } from './system.js';

interface Effect extends Subscriber, Dependency {
	fn(): void;
}

interface Computed<T = any> extends Signal<T | undefined>, Subscriber {
	getter: (cachedValue?: T) => T;
}

interface Signal<T = any> extends Dependency {
	currentValue: T;
}

type WriteableSignal<T> = {
	(): T;
	(value: T): void;
};

export function createDefaultSystem() {
	const {
		drainQueuedEffects,
		endTrack,
		isDirty,
		link,
		propagate,
		runInnerEffects,
		shallowPropagate,
		startTrack,
	} = createSystem({
		isComputed(sub: Subscriber & Dependency): sub is Computed {
			return 'getter' in sub;
		},
		isEffect(sub: Subscriber): sub is Effect {
			return !('getter' in sub);
		},
		notifyEffect(effect: Effect): void {
			const flags = effect.flags;
			if (
				flags & (SubscriberFlags.ToCheckDirty | SubscriberFlags.Dirty)
				&& isDirty(effect, flags)
			) {
				runEffect(effect);
				return;
			}
			if (flags & SubscriberFlags.InnerEffectsPending) {
				effect.flags = flags & ~SubscriberFlags.InnerEffectsPending;
				runInnerEffects(effect.deps!);
			}
		},
		updateComputed,
	});
	const pauseStack: (Subscriber | undefined)[] = [];

	let batchDepth = 0;
	let activeSub: Subscriber | undefined;

	return {
		get batchDepth() {
			return batchDepth;
		},
		get activeSub() {
			return activeSub;
		},
		set activeSub(sub) {
			activeSub = sub;
		},
		startBatch() {
			++batchDepth;
		},
		endBatch() {
			if (!--batchDepth) {
				drainQueuedEffects();
			}
		},
		pauseTracking() {
			pauseStack.push(activeSub);
			activeSub = undefined;
		},
		resumeTracking() {
			activeSub = pauseStack.pop();
		},
		signal,
		computed,
		effect,
	};

	//#region Public functions
	function signal<T>(): WriteableSignal<T | undefined>;
	function signal<T>(oldValue: T): WriteableSignal<T>;
	function signal<T>(oldValue?: T): WriteableSignal<T | undefined> {
		return signalGetSet.bind({
			currentValue: oldValue,
			subs: undefined,
			subsTail: undefined,
		}) as WriteableSignal<T | undefined>;
	}

	function computed<T>(getter: (cachedValue?: T) => T): () => T {
		return computedGet.bind({
			currentValue: undefined,
			subs: undefined,
			subsTail: undefined,
			deps: undefined,
			depsTail: undefined,
			flags: SubscriberFlags.Dirty,
			getter: getter as (cachedValue?: unknown) => unknown,
		}) as () => T;
	}

	function effect<T>(fn: () => T): () => void {
		const e: Effect = {
			fn,
			subs: undefined,
			subsTail: undefined,
			deps: undefined,
			depsTail: undefined,
			flags: SubscriberFlags.None,
		};
		if (activeSub !== undefined) {
			link(e, activeSub);
		}
		runEffect(e);
		return effectStop.bind(e);
	}
	//#endregion

	//#region Internal functions
	function updateComputed(computed: Computed): boolean {
		const prevSub = activeSub;
		activeSub = computed;
		startTrack(computed);
		try {
			const oldValue = computed.currentValue;
			const newValue = computed.getter(oldValue);
			if (oldValue !== newValue) {
				computed.currentValue = newValue;
				return true;
			}
			return false;
		} finally {
			activeSub = prevSub;
			endTrack(computed);
		}
	}

	function runEffect(e: Effect): void {
		const prevSub = activeSub;
		activeSub = e;
		startTrack(e);
		try {
			e.fn();
		} finally {
			activeSub = prevSub;
			endTrack(e);
		}
	}
	//#endregion

	//#region Bound functions
	function computedGet<T>(this: Computed<T>): T {
		const flags = this.flags;
		if (
			flags & (SubscriberFlags.ToCheckDirty | SubscriberFlags.Dirty)
			&& isDirty(this, flags)
		) {
			if (updateComputed(this)) {
				const subs = this.subs;
				if (subs !== undefined) {
					shallowPropagate(subs);
				}
			}
		}
		if (activeSub !== undefined) {
			link(this, activeSub);
		}
		return this.currentValue!;
	}

	function signalGetSet<T>(this: Signal<T>, ...value: [T]): T | void {
		if (value.length) {
			if (this.currentValue !== (this.currentValue = value[0])) {
				const subs = this.subs;
				if (subs !== undefined) {
					propagate(subs);
					if (!batchDepth) {
						drainQueuedEffects();
					}
				}
			}
		} else {
			if (activeSub !== undefined) {
				link(this, activeSub);
			}
			return this.currentValue;
		}
	}

	function effectStop(this: Subscriber): void {
		startTrack(this);
		endTrack(this);
	}
	//#endregion
}
