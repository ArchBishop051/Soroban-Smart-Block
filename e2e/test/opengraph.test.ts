/**
 * OpenGraph validator tests for link previews
 * Validates that OpenGraph tags are properly formatted and will work with social media crawlers
 */

import { test, expect } from "@playwright/test";

const DETAIL_ROUTES = [
  { route: "/contract/CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234", expectedTitle: "Contract" },
  { route: "/event/12345", expectedTitle: "Event" },
  { route: "/tx/ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234", expectedTitle: "Transaction" },
  { route: "/ledger/12345", expectedTitle: "Ledger" },
];

test.describe("OpenGraph - Link Preview Validation", () => {
  DETAIL_ROUTES.forEach(({ route, expectedTitle }) => {
    test(`should have valid OpenGraph tags for ${route}`, async ({ page }) => {
      await page.goto(route);

      // Check og:title exists and is not empty
      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
      expect(ogTitle).toBeTruthy();
      expect(ogTitle?.length).toBeGreaterThan(5);
      expect(ogTitle).toContain(expectedTitle);

      // Check og:description exists and is not empty
      const ogDescription = await page.locator('meta[property="og:description"]').getAttribute("content");
      expect(ogDescription).toBeTruthy();
      expect(ogDescription?.length).toBeGreaterThan(20);
      expect(ogDescription?.length).toBeLessThan(300); // Keep under 300 chars for social media

      // Check og:type
      const ogType = await page.locator('meta[property="og:type"]').getAttribute("content");
      expect(ogType).toBe("website");

      // Check og:site_name
      const ogSiteName = await page.locator('meta[property="og:site_name"]').getAttribute("content");
      expect(ogSiteName).toBeTruthy();
      expect(ogSiteName).toContain("Soroban");

      // Check og:image exists
      const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
      expect(ogImage).toBeTruthy();
      expect(ogImage).toMatch(/\.(png|jpg|jpeg|webp)$/i);
    });

    test(`should have valid Twitter Card tags for ${route}`, async ({ page }) => {
      await page.goto(route);

      // Check twitter:card
      const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute("content");
      expect(twitterCard).toBeTruthy();
      expect(["summary", "summary_large_image", "app", "player"]).toContain(twitterCard);

      // Check twitter:title
      const twitterTitle = await page.locator('meta[name="twitter:title"]').getAttribute("content");
      expect(twitterTitle).toBeTruthy();
      expect(twitterTitle?.length).toBeGreaterThan(5);

      // Check twitter:description
      const twitterDescription = await page.locator('meta[name="twitter:description"]').getAttribute("content");
      expect(twitterDescription).toBeTruthy();
      expect(twitterDescription?.length).toBeGreaterThan(20);

      // Check twitter:image
      const twitterImage = await page.locator('meta[name="twitter:image"]').getAttribute("content");
      expect(twitterImage).toBeTruthy();
    });

    test(`should have matching OpenGraph and Twitter tags for ${route}`, async ({ page }) => {
      await page.goto(route);

      // og:title should match twitter:title
      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
      const twitterTitle = await page.locator('meta[name="twitter:title"]').getAttribute("content");
      expect(ogTitle).toBe(twitterTitle);

      // og:description should match twitter:description
      const ogDescription = await page.locator('meta[property="og:description"]').getAttribute("content");
      const twitterDescription = await page.locator('meta[name="twitter:description"]').getAttribute("content");
      expect(ogDescription).toBe(twitterDescription);

      // og:image should match twitter:image
      const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
      const twitterImage = await page.locator('meta[name="twitter:image"]').getAttribute("content");
      expect(ogImage).toBe(twitterImage);
    });
  });

  test("should not have duplicate meta tags", async ({ page }) => {
    await page.goto("/contract/CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234");

    // Count og:title tags - should be exactly 1
    const ogTitleCount = await page.locator('meta[property="og:title"]').count();
    expect(ogTitleCount).toBe(1);

    // Count og:description tags - should be exactly 1
    const ogDescriptionCount = await page.locator('meta[property="og:description"]').count();
    expect(ogDescriptionCount).toBe(1);
  });
});
