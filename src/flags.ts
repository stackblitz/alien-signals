// inline enums if disabled isolatedModules (type only)
export const enum ReactiveFlags {
	None = 0,
	Mutable = 1 << 0,
	Watching = 1 << 1,
	RecursedCheck = 1 << 2,
	Recursed = 1 << 3,
	Dirty = 1 << 4,
	Pending = 1 << 5,
}
