import { Tracker } from './tracker';
import { DirtyLevels, track, trigger } from './system';
import { Dep } from './dep';

export function computed<T>(getter: (oldValue?: T) => T) {
	let oldValue: T | undefined;

	const tracker = new Tracker(
		() => trigger(dep, DirtyLevels.MaybeDirty)
	);
	const fn = (): T => {
		track(dep);
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
	const dep = new Dep(fn);

	return fn;
}
