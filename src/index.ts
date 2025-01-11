export * from './system.js';

import { createDefaultSystem } from './defaultSystem.js';

let defaultSystem: ReturnType<typeof createDefaultSystem> | undefined;

export function getDefaultSystem() {
	return defaultSystem ??= createDefaultSystem();
}
