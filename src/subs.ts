import type { TrackToken } from './tracker';

export class Subs extends Map<TrackToken, number>  {
	constructor(public queryDirty?: () => void) {
		super();
	}
}
