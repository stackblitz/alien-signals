const path = require('path');
const ts = require('typescript');
const config = ts.getParsedCommandLineOfConfigFile(
	path.join(__dirname, 'tsconfig.json'),
	undefined,
	{
		...ts.sys,
		onUnRecoverableConfigFileDiagnostic: () => { },
	}
);

if (config === undefined) {
	console.error('Failed to parse tsconfig.json');
	process.exit(1);
}

const typesProgram = ts.createProgram({
	rootNames: config.fileNames,
	configFileParsingDiagnostics: config.errors,
	options: {
		...config.options,
		outDir: 'types',
		declaration: true,
		emitDeclarationOnly: true,
	},
});

const readFile = ts.sys.readFile;
ts.sys.readFile = (fileName) => {
	if (path.basename(fileName) === 'system.ts') {
		return readFile(fileName)
			.replace(`export const enum ReactiveFlags {`, `export const ReactiveFlags = {`)
			.replace(/(\w+) = (\d+),/g, `$1: $2,`);
	}
	return readFile(fileName);
}

const cjsProgram = ts.createProgram({
	rootNames: config.fileNames,
	configFileParsingDiagnostics: config.errors,
	options: {
		...config.options,
		outDir: 'cjs',
		removeComments: true,
		module: ts.ModuleKind.CommonJS,
	},
});
const esmProgram = ts.createProgram({
	rootNames: config.fileNames,
	configFileParsingDiagnostics: config.errors,
	options: {
		...config.options,
		outDir: 'esm',
		removeComments: true,
		module: ts.ModuleKind.ESNext,
	},
});

typesProgram.emit(undefined, ts.sys.writeFile);
cjsProgram.emit(undefined, (fileName, text) => {
	fileName = fileName.slice(0, -'.js'.length) + '.cjs';
	text = text.replace(/\.\/system\.js/g, './system.cjs');
	ts.sys.writeFile(fileName, text);
});
esmProgram.emit(undefined, (fileName, text) => {
	fileName = fileName.slice(0, -'.js'.length) + '.mjs';
	text = text.replace(/\.\/system\.js/g, './system.mjs');
	ts.sys.writeFile(fileName, text);
});
