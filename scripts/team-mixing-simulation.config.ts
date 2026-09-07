import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["scripts/team-mixing-simulation.test.ts"],
		testTimeout: 600_000,
	},
});
