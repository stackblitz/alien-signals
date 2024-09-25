import { link, track, Subscriber, broadcast, Dep } from './system';

export function computed<T>(_getter: (oldValue?: T) => T) {
	let oldValue: T | undefined;

	const getter = () => _getter(oldValue);
	const fn = (): T => {
		link(dep);
		if (
			subscriber.dirty
			&& !Object.is(
				oldValue,
				oldValue = track(subscriber, getter)
			)
		) {
			broadcast(dep);
		}
		return oldValue!;
	};
	const dep: Dep = {
		queryDirty: fn,
	};
	const subscriber = new Subscriber(dep);

	return fn;
}
