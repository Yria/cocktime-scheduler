import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	use: { baseURL: "http://127.0.0.1:4174", viewport: { width: 900, height: 700 }, trace: "retain-on-failure" },
	webServer: { command: "pnpm dev --host 127.0.0.1 --port 4174 --strictPort", url: "http://127.0.0.1:4174", reuseExistingServer: !process.env.CI },
});
