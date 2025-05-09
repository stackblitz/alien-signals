import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/system.ts"],
	outDir: "dist",
	format: ["esm", "cjs"],
	target: "es2021",
	platform: "neutral",
	clean: true,
	dts: true,
	fixedExtension: true,
	minify: false,
	outputOptions: (_, format) => {
		const es = format === "es";
		const dir = es ? "esm" : "cjs";
		const ext = es ? "mjs" : "cjs";
		return {
			entryFileNames: `${dir}/[name].${ext}`,
			chunkFileNames: `${dir}/[name]-[hash].${ext}`,
		};
	},
	publint: true,
});