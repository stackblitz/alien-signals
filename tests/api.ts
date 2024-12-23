import * as signals from '../src';

export {
	startBatch,
	endBatch,
} from '../src';

export const signal: typeof signals.signal = (getter => new Signal_DEV(getter)) as any;

export const computed: typeof signals.computed = (getter => new Computed_DEV(getter)) as any;

export const effect: typeof signals.effect = (fn => {
	const e = new Effect_DEV(fn);
	e.run();
	return e;
}) as any;

export const effectScope: typeof signals.effectScope = (() => new EffectScope_DEV()) as any;

class Signal_DEV<T = any> extends signals.Signal<T> {
	constructor(public currentValue: T) {
		super(currentValue);
		defineProtectedProperty(this, 'flags');
	}
}

class Computed_DEV<T = any> extends signals.Computed<T> {
	constructor(public getter: (cachedValue?: T) => T) {
		super(getter);
		defineProtectedProperty(this, 'flags');
	}
}

class Effect_DEV<T = any> extends signals.Effect<T> {
	constructor(public fn: () => T) {
		super(fn);
		defineProtectedProperty(this, 'flags');
	}
}

class EffectScope_DEV extends signals.EffectScope {
	constructor() {
		super();
		defineProtectedProperty(this, 'flags');
	}
}

function defineProtectedProperty(target: any, key: string): void {
	const privateKey = '_' + key;
	target[privateKey] = target[key];
	Object.defineProperty(target, key, {
		get() {
			return target[privateKey];
		},
		set(value) {
			if (value && value === target[privateKey]) {
				throw new Error('Unnecessary assignment: ' + key + ' = ' + value);
			}
			target[privateKey] = value;
		},
	});
}
