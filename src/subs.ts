import type { Tracker } from './tracker';

export class Subs extends Map<Tracker, number>  {
	constructor(public queryDirty?: () => void) {
		super();
	}
}
