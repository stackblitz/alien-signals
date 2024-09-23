import { Tracker } from './tracker';
import { DirtyLevels, track, trigger } from './system';
import { Subs } from './subs';

export function computed<T>(_getter: (oldValue?: T) => T) {
	let oldValue: T | undefined;
	let subs: Subs | undefined;

	const tracker = new Tracker(
		() => {
			if (subs) {
				trigger(subs, DirtyLevels.MaybeDirty);
			}
		}
	);
	const getter = () => _getter(oldValue);
	const fn = (): T => {
		track(subs ??= new Subs(fn));
		if (
			tracker.dirty
			&& !Object.is(
				oldValue,
				oldValue = tracker.track(getter)
			)
		) {
			trigger(subs, DirtyLevels.Dirty);
		}
		return oldValue!;
	};

	return fn;
}
