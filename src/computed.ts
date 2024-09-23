import { Tracker } from './tracker';
import { DirtyLevels, track, trigger } from './system';
import { Dep } from './dep';

export function computed<T>(getter: (oldValue?: T) => T) {
	let oldValue: T | undefined;
	let dep: Dep | undefined;

	const tracker = new Tracker(
		() => trigger(dep ??= new Dep(fn), DirtyLevels.MaybeDirty)
	);
	const fn = (): T => {
		track(dep ??= new Dep(fn));
		if (
			tracker.dirty
			&& !Object.is(
				oldValue,
				oldValue = tracker.track(() => getter(oldValue))
			)
		) {
			trigger(dep, DirtyLevels.Dirty);
		}
		return oldValue!;
	};

	return fn;
}
