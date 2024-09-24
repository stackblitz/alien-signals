import { DirtyLevels, Subscribers, link, track, Subscriber, trigger } from './system';

export function computed<T>(_getter: (oldValue?: T) => T) {
	let oldValue: T | undefined;
	let subs: Subscribers | undefined;

	const subscriber = new Subscriber(
		() => {
			if (subs) {
				trigger(subs, DirtyLevels.MaybeDirty);
			}
		}
	);
	const getter = () => _getter(oldValue);
	const fn = (): T => {
		link(subs ??= new Subscribers(fn));
		if (
			subscriber.dirty
			&& !Object.is(
				oldValue,
				oldValue = track(subscriber, getter)
			)
		) {
			trigger(subs, DirtyLevels.Dirty);
		}
		return oldValue!;
	};

	return fn;
}
