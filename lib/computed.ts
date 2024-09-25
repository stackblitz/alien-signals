import { link, track, Subscriber, broadcast, Dep, isDirty } from './system';

export function computed<T>(_getter: (oldValue?: T) => T) {
	let oldValue: T | undefined;

	const getter = () => _getter(oldValue);
	const fn = (): T => {
		link(dep);
		if (
			isDirty(subscriber)
			&& !Object.is(
				oldValue,
				oldValue = track(subscriber, getter)
			)
		) {
			broadcast(dep);
		}
		return oldValue!;
	};
	const dep = new Dep(fn);
	const subscriber = new Subscriber(dep);

	return fn;
}
