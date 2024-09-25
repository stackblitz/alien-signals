import { Dependency } from './system';

export class Signal<T = any> {
	private dep = new Dependency();

	constructor(
		private oldValue: T | undefined = undefined
	) { }

	get() {
		this.dep.link();
		return this.oldValue!;
	}

	set(value: T) {
		if (!Object.is(this.oldValue, this.oldValue = value)) {
			this.dep.broadcast();
		}
	}
}

export function signal<T>(): Signal<T | undefined>;
export function signal<T>(oldValue: T): Signal<T>;
export function signal<T>(oldValue?: T): Signal<T | undefined> {
	return new Signal(oldValue);
}
