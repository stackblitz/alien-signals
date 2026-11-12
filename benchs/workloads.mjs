// Workloads shared by instructions.mjs and wallclock.mjs. Each one builds a
// graph with the given implementation and returns the step that is measured.

export const workloads = {
	// 10 chains of 10 computeds, each ending in an effect; one write reaches all
	grid({ signal, computed, effect }) {
		const src = signal(1);
		for (let i = 0; i < 10; i++) {
			let last = src;
			for (let j = 0; j < 10; j++) {
				const prev = last;
				last = computed(() => prev() + 1);
			}
			effect(() => { last(); });
		}
		return () => src(src() + 1);
	},
	// 1 signal read by 100 effects
	wide({ signal, effect }) {
		const src = signal(1);
		for (let i = 0; i < 100; i++) {
			effect(() => { src(); });
		}
		return () => src(src() + 1);
	},
	// 100 reads of an up-to-date computed and of a signal
	read({ signal, computed, effect }) {
		const src = signal(1);
		const c = computed(() => src() + 1);
		let check = 0;
		effect(() => { c(); });
		return () => {
			for (let j = 0; j < 100; j++) {
				check += c() + src();
			}
		};
	},
	// a chain of 10 computeds nothing subscribes to: written once, read 10 times
	unwatched({ signal, computed }) {
		const src = signal(1);
		let last = src;
		for (let j = 0; j < 10; j++) {
			const prev = last;
			last = computed(() => prev() + 1);
		}
		let k = 0;
		let check = 0;
		return () => {
			src(++k);
			for (let j = 0; j < 10; j++) {
				check += last();
			}
		};
	},
	// the same chain, read after a write to a signal it does not depend on
	unrelated({ signal, computed }) {
		const src = signal(1);
		const other = signal(0);
		let last = src;
		for (let j = 0; j < 10; j++) {
			const prev = last;
			last = computed(() => prev() + 1);
		}
		let k = 0;
		let check = 0;
		return () => {
			other(++k);
			check += last();
		};
	},
	// signal, computed and effect created, updated once and disposed
	create({ signal, computed, effect }) {
		let k = 0;
		return () => {
			const s = signal(++k);
			const c = computed(() => s() + 1);
			const stop = effect(() => { c(); });
			s(k + 1);
			stop();
		};
	},
	// diamonds with a dependency that switches, a batch, and an effect that writes
	diamond({ signal, computed, effect, startBatch, endBatch }) {
		const a = signal(0);
		const b = signal(0);
		const out = signal(0);
		const parity = computed(() => a() % 2);
		const sum = computed(() => a() + b());
		const pick = computed(() => parity() ? sum() : b());
		const fan = [];
		for (let i = 0; i < 8; i++) {
			fan.push(computed(() => pick() + i));
		}
		effect(() => {
			let t = 0;
			for (const f of fan) {
				t += f();
			}
			out(t);
		});
		effect(() => { out(); });
		let k = 0;
		return () => {
			a(++k);
			startBatch();
			b(k >> 1);
			a(k + 1);
			endBatch();
		};
	},
	// a batch that leaves every value as it was
	aba({ signal, computed, effect, startBatch, endBatch }) {
		const a = signal(0);
		const cs = [];
		for (let i = 0; i < 10; i++) {
			cs.push(computed(() => a() + i));
		}
		effect(() => {
			for (const c of cs) {
				c();
			}
		});
		return () => {
			startBatch();
			a(1);
			a(0);
			endBatch();
		};
	},
};
