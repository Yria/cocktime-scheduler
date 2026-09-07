import { defineConfig } from "vitest/config";

// Explicit diagnostic run; known failures do not enter the normal src/** test suite.
export default defineConfig({
	esbuild: { jsx: "automatic" },
	test: {
		include: ["scripts/team-matching-repro.test.tsx"],
		reporters: ["verbose"],
		testTimeout: 10_000,
		hookTimeout: 30_000,
	},
});
