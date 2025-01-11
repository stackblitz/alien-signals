import { computed, effect, signal } from '../esm/index.mjs';

globalThis.gc();
let start = process.memoryUsage().heapUsed;

const signals = Array.from({ length: 10000 }, () => signal(0));

globalThis.gc();
let end = process.memoryUsage().heapUsed;

console.log(`signal: ${((end - start) / 1024).toFixed(2)} KB`);

start = end;

const computeds = Array.from({ length: 10000 }, (_, i) => computed(() => signals[i].get() + 1));

globalThis.gc();
end = process.memoryUsage().heapUsed;

console.log(`computed: ${((end - start) / 1024).toFixed(2)} KB`);

start = end;

Array.from({ length: 10000 }, (_, i) => effect(() => computeds[i].get()));

globalThis.gc();
end = process.memoryUsage().heapUsed;

console.log(`effect: ${((end - start) / 1024).toFixed(2)} KB`);
