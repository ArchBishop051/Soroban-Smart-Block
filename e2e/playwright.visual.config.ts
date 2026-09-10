import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

/**
 * Visual-regression config. Reuses the base config (web servers, screenshot
 * tolerances, updateSnapshots policy) but points `testDir` at ./test/visual,
 * where visual-regression.spec.ts lives — the base config's testDir is
 * ./test/playwright, so `playwright test test/visual/...` finds nothing.
 */
export default defineConfig({
  ...baseConfig,
  testDir: "./test/visual",
});
