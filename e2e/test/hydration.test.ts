/**
 * Hydration mismatch tests
 * Verifies that SSR and client-side rendering produce identical markup
 */

import { test, expect } from "@playwright/test";

test.describe("Hydration - No Mismatches", () => {
  test("should have zero hydration mismatches on detail pages", async ({ page, context }) => {
    // Enable console logging to catch hydration warnings
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    // Navigate to a detail page
    await page.goto("/contract/CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234");

    // Wait for page to fully load
    await page.waitForLoadState("networkidle");

    // Check for hydration warnings in console
    const hydrationWarnings = consoleMessages.filter(
      (msg) => 
        msg.includes("hydration") || 
        msg.includes("mismatch") ||
        msg.includes("did not match")
    );

    expect(hydrationWarnings.length).toBe(0);
  });

  test("should have zero hydration mismatches on event page", async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    await page.goto("/event/12345");
    await page.waitForLoadState("networkidle");

    const hydrationWarnings = consoleMessages.filter(
      (msg) => 
        msg.includes("hydration") || 
        msg.includes("mismatch") ||
        msg.includes("did not match")
    );

    expect(hydrationWarnings.length).toBe(0);
  });

  test("should have zero hydration mismatches on transaction page", async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    await page.goto("/tx/ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234");
    await page.waitForLoadState("networkidle");

    const hydrationWarnings = consoleMessages.filter(
      (msg) => 
        msg.includes("hydration") || 
        msg.includes("mismatch") ||
        msg.includes("did not match")
    );

    expect(hydrationWarnings.length).toBe(0);
  });

  test("should have zero hydration mismatches on ledger page", async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    await page.goto("/ledger/12345");
    await page.waitForLoadState("networkidle");

    const hydrationWarnings = consoleMessages.filter(
      (msg) => 
        msg.includes("hydration") || 
        msg.includes("mismatch") ||
        msg.includes("did not match")
    );

    expect(hydrationWarnings.length).toBe(0);
  });

  test("client-only components should not cause hydration issues", async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on("console", (msg) => {
      consoleMessages.push(msg.text());
    });

    // Navigate to a page with client-only components
    await page.goto("/wallet/GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234");
    await page.waitForLoadState("networkidle");

    const hydrationWarnings = consoleMessages.filter(
      (msg) => 
        msg.includes("hydration") || 
        msg.includes("mismatch") ||
        msg.includes("did not match")
    );

    expect(hydrationWarnings.length).toBe(0);
  });
});
