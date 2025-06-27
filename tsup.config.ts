import { defineConfig } from "tsup";

export default defineConfig([
	{
 		entry: ["src/index.ts", "src/core.ts"],
		tsconfig: "tsconfig.build.json",
		format: ["esm"],
		platform: "browser",
		dts: true,
		outDir: "dist/esm",
		sourcemap: true,
		clean: true,
	},
	{
		entry: ["src/index.ts", "src/core.ts"],
		format: ["cjs"],
		tsconfig: "tsconfig.build.json",
		dts: true,
		outDir: "dist/cjs",
		sourcemap: true,
		clean: true,
	},
]);
