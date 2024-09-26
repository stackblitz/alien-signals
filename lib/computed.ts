import { Subscriber, Dependency } from './system';

export class Computed<T = any> {
	private oldValue: T | undefined = undefined;
	private dep = new Dependency(this);
	private sub = new Subscriber(this.dep);

	constructor(
		private getter: (oldValue?: T) => T
	) { }

	get(): T {
		this.dep.link();
		if (this.sub.isDirty()) {
			this.sub.trackStart();
			if (!Object.is(
				this.oldValue,
				this.oldValue = this.getter(this.oldValue)
			)) {
				this.dep.broadcast();
			}
			this.sub.trackEnd();
		}
		return this.oldValue!;
	}
}

export function computed<T>(getter: (oldValue?: T) => T) {
	return new Computed(getter);
}
