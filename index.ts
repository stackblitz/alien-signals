import { Dependency } from './lib/system.js';

export * from './lib/computed.js';
export * from './lib/effect.js';
export * from './lib/effectScope.js';
export * from './lib/signal.js';
export * from './lib/system.js';

export function enableEffectsPropagation() {
	Dependency.propagate = Dependency.effectsPropagate;
}
