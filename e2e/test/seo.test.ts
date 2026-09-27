/**
 * SEO tests for detail pages
 * Validates OpenGraph tags, meta descriptions, and JSON-LD
 */

import { test, expect } from "@playwright/test";

const DETAIL_ROUTES = [
  "/contract/CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
  "/event/12345",
  "/tx/ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
  "/ledger/12345",
];

test.describe("SEO - Detail Pages", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the page
  });

  DETAIL_ROUTES.forEach((route) => {
    test(`should have proper meta tags for ${route}`, async ({ page }) => {
      await page.goto(route);

      // Check for title
      const title = await page.title();
      expect(title).toBeTruthy();
      expect(title.length).toBeGreaterThan(10);

      // Check for meta description
      const metaDescription = await page.locator('meta[name="description"]').getAttribute("content");
      expect(metaDescription).toBeTruthy();
      expect(metaDescription?.length).toBeGreaterThan(20);

      // Check for OpenGraph tags
      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
      expect(ogTitle).toBeTruthy();

      const ogDescription = await page.locator('meta[property="og:description"]').getAttribute("content");
      expect(ogDescription).toBeTruthy();

      const ogType = await page.locator('meta[property="og:type"]').getAttribute("content");
      expect(ogType).toBe("website");

      // Check for Twitter card tags
      const twitterCard = await page.locator('meta[name="twitter:card"]').getAttribute("content");
      expect(twitterCard).toBeTruthy();

      const twitterTitle = await page.locator('meta[name="twitter:title"]').getAttribute("content");
      expect(twitterTitle).toBeTruthy();
    });

    test(`should have JSON-LD structured data for ${route}`, async ({ page }) => {
      await page.goto(route);

      // Check for JSON-LD script tag
      const jsonLdScript = await page.locator('script[type="application/ld+json"]').getAttribute("content");
      expect(jsonLdScript).toBeTruthy();

      // Validate JSON-LD is valid JSON
      const jsonLd = JSON.parse(jsonLdScript || "{}");
      expect(jsonLd).toHaveProperty("@context");
      expect(jsonLd["@context"]).toBe("https://schema.org");
      expect(jsonLd).toHaveProperty("@type");
    });
  });

  test("should have sitemap.xml", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/xml");

    const body = await response.text();
    expect(body).toContain("<?xml");
    expect(body).toContain("<urlset");
    expect(body).toContain("http");
  });
});
