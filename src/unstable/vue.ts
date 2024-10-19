import {
	Computed,
	Dependency,
	DirtyLevels,
	Effect,
	EffectScope,
	Signal,
	Subscriber,
	System,
} from '../index.js';

export { EffectScope };

export function effect(fn: () => void) {
	const e = new ReactiveEffect(fn);
	e.run();
	return e;
}

let currentEffectScope: VueEffectScope | undefined = undefined;

class VueEffectScope extends EffectScope {
	onDispose: (() => void)[] = [];

	run<T>(fn: () => T): T {
		const prevScope = currentEffectScope;
		currentEffectScope = this;
		const res = super.run(fn);
		currentEffectScope = prevScope;
		return res;
	}

	stop() {
		super.stop();
		this.onDispose.forEach(cb => cb());
	}
}

export function effectScope() {
	return new VueEffectScope();
}

export function triggerRef(ref: ShallowRef) {
	if (ref.subs !== undefined) {
		System.startBatch();
		Dependency.propagate(ref.subs);
		System.endBatch();
	}
}

const pausedSubsVersions: number[] = [];

export function pauseTracking() {
	pausedSubsVersions.push(System.activeSubVersion);
	System.activeSubVersion = -1;
}

export function resetTracking() {
	System.activeSubVersion = pausedSubsVersions.pop()!;
}

export function shallowRef<T = any>(): ShallowRef<T | undefined>;
export function shallowRef<T = any>(oldValue: T): ShallowRef<T>;
export function shallowRef<T = any>(value?: T) {
	return new ShallowRef(value);
}

export function computed<T>(options: {
	get(): T;
	set(value: T): void;
}): { value: T; };
export function computed<T>(fn: () => T): { readonly value: T; };
export function computed<T>(fn: (() => T) | {
	get(): T;
	set(value: T): void;
}) {
	if (typeof fn === 'function') {
		return new VueComputed(fn);
	} else {
		const { get, set } = fn;
		const c = new VueComputed(get);
		return {
			get value() {
				return c.get();
			},
			set value(value: T) {
				set(value);
			},
		};
	}
}

export function getCurrentScope() {
	return currentEffectScope;
}

export class ShallowRef<T = any> extends Signal<T> {
	get value() {
		return this.get();
	}
	set value(value: T) {
		this.set(value);
	}
}

class VueComputed<T = any> extends Computed<T> {
	get value() {
		return this.get();
	}
}

export class ReactiveEffect extends Effect {
	get dirty() {
		if (this.versionOrDirtyLevel === DirtyLevels.MaybeDirty) {
			Subscriber.resolveMaybeDirty(this);
		}
		return this.versionOrDirtyLevel === DirtyLevels.Dirty;
	}

	set scheduler(fn: () => void) {
		this.notify = fn;
	}

	stop() {
		if (this.deps !== undefined) {
			Subscriber.clearTrack(this.deps);
			this.deps = undefined;
			this.depsTail = undefined;
		}
		this.versionOrDirtyLevel = DirtyLevels.None;
	}
}

export function onScopeDispose(cb: () => void) {
	currentEffectScope?.onDispose.push(cb);
}
