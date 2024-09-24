import { Subscribers, link, track, Subscriber, broadcast } from './system';

export function computed<T>(_getter: (oldValue?: T) => T) {
	let oldValue: T | undefined;

	const getter = () => _getter(oldValue);
	const fn = (): T => {
		link(subs);
		if (
			subscriber.dirty
			&& !Object.is(
				oldValue,
				oldValue = track(subscriber, getter)
			)
		) {
			broadcast(subs);
		}
		return oldValue!;
	};
	const subs = new Subscribers(fn);
	const subscriber = new Subscriber(subs);

	return fn;
}
