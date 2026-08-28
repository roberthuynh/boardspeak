import { defineConfig } from "@playwright/test";

const port = 3_100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".next/playwright-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  timeout: 20_000,
  expect: {
    timeout: 7_000,
  },
  use: {
    baseURL,
    browserName: "chromium",
    colorScheme: "dark",
    contextOptions: {
      reducedMotion: "reduce",
    },
    viewport: { width: 1_440, height: 1_000 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: `pnpm exec next dev --turbopack --hostname 127.0.0.1 --port ${port}`,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
});
