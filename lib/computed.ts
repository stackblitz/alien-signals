import { Subscriber, Dependency } from './system';

export function computed<T>(_getter: (oldValue?: T) => T) {
	let oldValue: T | undefined;

	const getter = () => _getter(oldValue);
	const fn = (): T => {
		dep.link();
		if (
			subscriber.isDirty()
			&& !Object.is(
				oldValue,
				oldValue = subscriber.track(getter)
			)
		) {
			dep.broadcast();
		}
		return oldValue!;
	};
	const dep = new Dependency(fn);
	const subscriber = new Subscriber(dep);

	return fn;
}
