import express from "express";
import { XMLBuilder } from "fast-xml-parser";

const API_BASE = process.env.API_URL || "http://localhost:3001";

/**
 * Generate sitemap.xml for registered contracts and tokens
 */
export async function generateSitemap() {
  try {
    // Fetch registered contracts
    const contractsResponse = await fetch(`${API_BASE}/api/contracts?limit=1000`);
    const contractsData = contractsResponse.ok ? await contractsResponse.json() : { data: [] };
    
    // Fetch tokens
    const tokensResponse = await fetch(`${API_BASE}/api/tokens?limit=1000`);
    const tokensData = tokensResponse.ok ? await tokensResponse.json() : { data: [] };

    const baseUrl = process.env.SITE_URL || "https://explorer.example.com";
    const currentDate = new Date().toISOString();

    const urlElements = [
      // Static pages
      {
        loc: `${baseUrl}/`,
        lastmod: currentDate,
        changefreq: "daily",
        priority: "1.0",
      },
      {
        loc: `${baseUrl}/events`,
        lastmod: currentDate,
        changefreq: "always",
        priority: "0.9",
      },
      {
        loc: `${baseUrl}/contracts`,
        lastmod: currentDate,
        changefreq: "daily",
        priority: "0.8",
      },
    ];

    // Add contract URLs
    for (const contract of contractsData.data || []) {
      urlElements.push({
        loc: `${baseUrl}/contract/${contract.id}`,
        lastmod: contract.registered_at || currentDate,
        changefreq: "weekly",
        priority: "0.7",
      });
    }

    // Add token URLs
    for (const token of tokensData.data || []) {
      urlElements.push({
        loc: `${baseUrl}/token/${token.id}`,
        lastmod: currentDate,
        changefreq: "weekly",
        priority: "0.7",
      });
    }

    // Build XML
    const sitemap = {
      "?xml": {
        "@version": "1.0",
        "@encoding": "UTF-8",
      },
      urlset: {
        "@xmlns": "http://www.sitemaps.org/schemas/sitemap/0.9",
        url: urlElements,
      },
    };

    const builder = new XMLBuilder({ ignoreAttributes: false });
    return builder.build(sitemap);
  } catch (error) {
    console.error("Failed to generate sitemap:", error);
    // Return a minimal sitemap on error
    const baseUrl = process.env.SITE_URL || "https://explorer.example.com";
    const currentDate = new Date().toISOString();
    
    const minimalSitemap = {
      "?xml": {
        "@version": "1.0",
        "@encoding": "UTF-8",
      },
      urlset: {
        "@xmlns": "http://www.sitemaps.org/schemas/sitemap/0.9",
        url: [
          {
            loc: `${baseUrl}/`,
            lastmod: currentDate,
            changefreq: "daily",
            priority: "1.0",
          },
        ],
      },
    };

    const builder = new XMLBuilder({ ignoreAttributes: false });
    return builder.build(minimalSitemap);
  }
}

/**
 * Express middleware to serve sitemap.xml
 */
export function sitemapMiddleware(req, res) {
  generateSitemap()
    .then((xml) => {
      res.set("Content-Type", "application/xml");
      res.send(xml);
    })
    .catch((error) => {
      console.error("Sitemap generation error:", error);
      res.status(500).send("Error generating sitemap");
    });
}
