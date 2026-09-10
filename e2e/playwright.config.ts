import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/playwright",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // The visual-regression suite ships without committed baselines. "missing"
  // lets the first run write any absent snapshot (and pass) while still
  // diffing every snapshot that *does* exist, so once a baseline is committed
  // it becomes an enforced gate. Set PLAYWRIGHT_UPDATE_SNAPSHOTS=none to make
  // a missing baseline a hard failure instead.
  updateSnapshots:
    (process.env.PLAYWRIGHT_UPDATE_SNAPSHOTS as "all" | "changed" | "missing" | "none") ||
    "missing",
  reporter: [
    ["html"],
    ["json", { outputFile: "test-results/e2e.json" }],
    ["junit", { outputFile: "test-results/e2e-junit.xml" }],
  ],

  use: {
    baseURL: process.env.FRONTEND_URL || "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  // Screenshot comparison tolerances — small cross-run rendering noise
  // (antialiasing, subpixel text) must not fail the build.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "Mobile Safari",
      use: { ...devices["iPhone 14"] },
    },
  ],

  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      cwd: "../frontend",
    },
    {
      command: "npm start",
      url: "http://localhost:3001/health",
      reuseExistingServer: !process.env.CI,
      cwd: "../indexer",
      // The indexer's HTTP API only binds a port when NODE_ENV is not "test"
      // (see indexer/src/api.js) — Jest suites import the app without
      // listening. Force a non-test env here so `/health` actually comes up
      // for Playwright, regardless of what the CI job exports.
      env: { NODE_ENV: "development" },
    },
  ],
});
