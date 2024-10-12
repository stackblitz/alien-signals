import { Dependency } from './lib/system';

export * from './lib/computed';
export * from './lib/effect';
export * from './lib/effectScope';
export * from './lib/signal';
export * from './lib/system';

export function enableEffectsPropagation() {
	Dependency.propagate = Dependency.effectsPropagate;
}
