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
	options: {
		...config.options,
		outDir: 'types',
		declaration: true,
		emitDeclarationOnly: true,
	},
	configFileParsingDiagnostics: config.errors,
});
const cjsProgram = ts.createProgram({
	rootNames: config.fileNames,
	options: {
		...config.options,
		outDir: 'cjs',
		removeComments: true,
		module: ts.ModuleKind.CommonJS,
	},
	configFileParsingDiagnostics: config.errors,
});
const esmProgram = ts.createProgram({
	rootNames: config.fileNames,
	options: {
		...config.options,
		outDir: 'esm',
		removeComments: true,
		module: ts.ModuleKind.ESNext,
	},
	configFileParsingDiagnostics: config.errors,
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
