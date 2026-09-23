import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:5719",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  reporter: "list",
});
