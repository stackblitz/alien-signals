import { defineConfig, type Options } from "tsdown";

const shared = {
	entry: ["src/index.ts", "src/system.ts"],
	platform: "neutral",
	clean: true,
	dts: true,
	fixedExtension: true,
	minify: false,
} satisfies Options;

export default defineConfig([
	{
		format: "esm",
		outDir: "dist/esm",
		...shared
	},
	{
		format: "cjs",
		outDir: "dist/cjs",
		...shared
	},
]);