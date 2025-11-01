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

const iifeRe = /(export\s*)?var\s+([A-Za-z_$][\w$]*)\s*;\s*\(\s*function\s*\(\s*\2\s*\)\s*\{\s*([\s\S]*?)\s*\}\s*\)\s*\(\s*\2\s*\|\|\s*\(\s*(?:exports\.\2\s*=\s*)?\2\s*=\s*\{\}\s*\)\s*\)\s*;?/g;
const entryRe = /\[\s*(['"])([^'"]+)\1\s*\]\s*=\s*([^\]]+?)\s*\]/g;

function transformEnumsToConst(js) {
	return js.replace(iifeRe, (whole, esmExport, name, body) => {
		const props = Array.from(body.matchAll(entryRe), ([, , k, v]) => `    ${k}: ${v},`)
		if (!props.length)
			return whole;

		const left = esmExport ? `export const ${name}` : `exports.${name}`;
		return `${left} = {\n${props.join("\n")}\n};`;
	});
}

typesProgram.emit(undefined, ts.sys.writeFile);
cjsProgram.emit(undefined, (fileName, text) => {
	fileName = fileName.slice(0, -'.js'.length) + '.cjs';
	text = text.replace(/\.\/system\.js/g, './system.cjs');
	text = transformEnumsToConst(text);
	ts.sys.writeFile(fileName, text);
});
esmProgram.emit(undefined, (fileName, text) => {
	fileName = fileName.slice(0, -'.js'.length) + '.mjs';
	text = text.replace(/\.\/system\.js/g, './system.mjs');
	text = transformEnumsToConst(text);
	ts.sys.writeFile(fileName, text);
});
