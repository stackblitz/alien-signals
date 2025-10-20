require('./build.js');

const rolldown = require('rolldown');

rolldown.build({
	input: 'esm/index.mjs', output: { minify: true }, write: false, treeshake: true
}).then(built => {
	console.log(`esm/index.mjs: ${(built.output[0].code.length / 1024).toFixed(2)} KB`);
});
rolldown.build({
	input: 'esm/system.mjs', output: { minify: true }, write: false, treeshake: true
}).then(built => {
	console.log(`esm/system.mjs: ${(built.output[0].code.length / 1024).toFixed(2)} KB`);
});
rolldown.build({
	input: 'cjs/index.cjs', output: { minify: true }, write: false, treeshake: true
}).then(built => {
	console.log(`cjs/index.cjs: ${(built.output[0].code.length / 1024).toFixed(2)} KB`);
});
rolldown.build({
	input: 'cjs/system.cjs', output: { minify: true }, write: false, treeshake: true
}).then(built => {
	console.log(`cjs/system.cjs: ${(built.output[0].code.length / 1024).toFixed(2)} KB`);
});
