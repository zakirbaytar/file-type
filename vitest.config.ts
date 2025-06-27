import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.(spec|test).ts", "test/**/*.(spec|test).ts"],
		coverage: {
			reporter: ["text", "json", "html"],
		},
	},
});
