import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/daemon/index.ts",
		"src/hooks/pre-prompt.ts",
		"src/hooks/post-tool-result.ts",
	],
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	splitting: false,
	external: ["../crates/cortex-engine/cortex-engine.linux-x64-gnu.node"],
});
