import { DirtyLevels, track, trigger } from './system';
import { Dep } from './dep';

export interface Signal<T = any> {
	(): T;
	set(newValue: T): void;
	markDirty(): void;
}

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(oldValue: T): Signal<T>;
export function signal<T>(oldValue?: T): Signal<T | undefined> {
	const dep = new Dep();
	const fn = (() => {
		track(dep);
		return oldValue;
	}) as Signal;

	fn.markDirty = () => {
		trigger(dep, DirtyLevels.Dirty);
	};
	fn.set = (newValue) => {
		if (!Object.is(oldValue, oldValue = newValue)) {
			fn.markDirty();
		}
	};

	return fn;
}
