import { Dependency, DirtyLevels, Subscriber } from './system';

export class Computed<T = any> implements Dependency, Subscriber {
	oldValue: T | undefined = undefined;

	// Dependency
	subs = undefined;
	subsTail = undefined;
	subVersion = -1;

	// Subscriber
	deps = undefined;
	depsTail = undefined;
	versionOrDirtyLevel = DirtyLevels.Dirty;

	constructor(
		public getter: (oldValue?: T) => T
	) { }

	update() {
		if (Subscriber.isDirty(this)) {
			const lastActiveSub = Subscriber.startTrack(this);
			if (this.oldValue !== (this.oldValue = this.getter(this.oldValue))) {
				Subscriber.endTrack(this, lastActiveSub);
				Dependency.propagate(this);
			}
			else {
				Subscriber.endTrack(this, lastActiveSub);
			}
		}
	}

	get(): T {
		Dependency.link(this);
		if (Subscriber.isDirty(this)) {
			const lastActiveSub = Subscriber.startTrack(this);
			if (this.oldValue !== (this.oldValue = this.getter(this.oldValue))) {
				Subscriber.endTrack(this, lastActiveSub);
				Dependency.propagate(this);
			}
			else {
				Subscriber.endTrack(this, lastActiveSub);
			}
		}
		return this.oldValue!;
	}
}

export class EqualityComputed<T = any> extends Computed<T> {
	constructor(
		getter: () => T,
	) {
		super(oldValue => {
			const newValue = getter();
			if (this.equals(oldValue, newValue)) {
				return oldValue!;
			}
			return newValue;
		});
	}

	equals(a: any, b: any): boolean {
		if (a === b) {
			return true;
		}

		if (a === null || b === null || typeof a !== typeof b) {
			return false;
		}

		if (typeof a === 'object') {
			if (Array.isArray(a) && Array.isArray(b)) {
				if (a.length !== b.length) {
					return false;
				}
				for (let i = 0; i < a.length; i++) {
					if (!this.equals(a[i], b[i])) {
						return false;
					}
				}
				return true;
			}

			if (!Array.isArray(a) && !Array.isArray(b)) {
				for (const key in a) {
					if (a.hasOwnProperty(key)) {
						if (!b.hasOwnProperty(key) || !this.equals(a[key], b[key])) {
							return false;
						}
					}
				}
				for (const key in b) {
					if (b.hasOwnProperty(key) && !a.hasOwnProperty(key)) {
						return false;
					}
				}
				return true;
			}

			return false; // One is array and the other is not
		}

		return false;
	}
}

export function computed<T>(getter: (oldValue?: T) => T) {
	return new Computed(getter);
}

export function equalityComputed<T>(getter: () => T) {
	return new EqualityComputed(getter);
}
