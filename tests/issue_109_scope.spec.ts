import { test } from 'vitest';
import { computed, effect, effectScope, signal } from '../src';

// Same shape as issue_109.spec.ts, but the dispose target is an
// effectScope instead of an effect. effectScopeOper has no defer
// branch in the current fix, so unwatched() cascades immediately and
// the original crash should still reproduce.
test('#109 scope-variant: dispose effectScope during computed update', () => {
	const s = signal(false);
	let disposeScope!: () => void;

	const a = computed(() => {
		if (s()) disposeScope();
		return 0;
	});
	const b = computed(() => a());

	disposeScope = effectScope(() => {
		effect(() => { b(); });
	});

	s(true);
});
