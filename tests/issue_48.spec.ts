import { test } from 'vitest';
import { computed, effect, setCurrentSub, signal } from '../src';

test('#48', () => {
	const source = signal(0);
	let disposeInner: () => void;

	reaction(
		() => source(),
		(val) => {
			if (val === 1) {
				disposeInner = reaction(
					() => source(),
					() => { }
				);
			} else if (val === 2) {
				disposeInner!();
			}
		}
	);

	source(1);
	source(2);
	source(3);
});

interface ReactionOptions<T = unknown, F extends boolean = boolean> {
	fireImmediately?: F;
	equals?: F extends true
	? (a: T, b: T | undefined) => boolean
	: (a: T, b: T) => boolean;
	onError?: (error: unknown) => void;
	scheduler?: (fn: () => void) => void;
	once?: boolean;
}

function reaction<T>(
	dataFn: () => T,
	effectFn: (newValue: T, oldValue: T | undefined) => void,
	options: ReactionOptions<T> = {}
): () => void {
	const {
		scheduler = (fn) => fn(),
		equals = Object.is,
		onError,
		once = false,
		fireImmediately = false,
	} = options;

	let prevValue: T | undefined;
	let version = 0;

	const tracked = computed(() => {
		try {
			return dataFn();
		} catch (error) {
			untracked(() => onError?.(error));
			return prevValue!;
		}
	});

	const dispose = effect(() => {
		const current = tracked();
		if (!fireImmediately && !version) {
			prevValue = current;
		}
		version++;
		if (equals(current, prevValue!)) return;
		const oldValue = prevValue;
		prevValue = current;
		untracked(() =>
			scheduler(() => {
				try {
					effectFn(current, oldValue);
				} catch (error) {
					onError?.(error);
				} finally {
					if (once) {
						if (fireImmediately && version > 1) dispose();
						else if (!fireImmediately && version > 0) dispose();
					}
				}
			})
		);
	});

	return dispose;
}

function untracked<T>(callback: () => T): T {
	const currentSub = setCurrentSub(undefined);
	try {
		return callback();
	} finally {
		setCurrentSub(currentSub);
	}
}
