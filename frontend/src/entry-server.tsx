import React from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import App from "./App";
import { loadDataForRoute } from "./ssr/dataLoaders";

export async function render(url: string, template: string) {
  // Load data for SSR routes
  const data = await loadDataForRoute(url);

  // Generate meta tags based on data
  let metaTags = "";
  let jsonLd = "";
  if (data) {
    const title = generateTitle(url, data);
    const description = generateDescription(url, data);
    
    metaTags = `
      <meta property="og:title" content="${title}" />
      <meta property="og:description" content="${description}" />
      <meta name="twitter:title" content="${title}" />
      <meta name="twitter:description" content="${description}" />
    `;

    jsonLd = generateJsonLd(url, data);
  }

  // Inject meta tags into template
  template = template.replace(
    /<meta property="og:title"[^>]*>/,
    metaTags
  );

  // Inject JSON-LD before closing head tag
  template = template.replace(
    /<\/head>/,
    `${jsonLd}</head>`
  );

  const appHtml = renderToString(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>
  );

  const html = template.replace(`<!--app-html-->`, appHtml);

  return html;
}

function generateTitle(url: string, data: any): string {
  if (url.startsWith("/contract/")) {
    return data.name ? `Contract: ${data.name} — Soroban Explorer` : `Contract ${data.id} — Soroban Explorer`;
  }
  if (url.startsWith("/token/")) {
    return data.symbol ? `Token: ${data.symbol} — Soroban Explorer` : `Token ${data.id} — Soroban Explorer`;
  }
  if (url.startsWith("/tx/")) {
    return `Transaction ${data.hash.slice(0, 8)}... — Soroban Explorer`;
  }
  if (url.startsWith("/event/")) {
    return `Event #${data.seq} — Soroban Explorer`;
  }
  if (url.startsWith("/ledger/")) {
    return `Ledger #${data.seq} — Soroban Explorer`;
  }
  return "Soroban Smart Block Explorer";
}

function generateDescription(url: string, data: any): string {
  if (url.startsWith("/contract/")) {
    return data.description || `View details for contract ${data.id} on the Soroban Smart Block Explorer.`;
  }
  if (url.startsWith("/token/")) {
    return `View details for token ${data.symbol || data.id} on the Soroban Smart Block Explorer.`;
  }
  if (url.startsWith("/tx/")) {
    return `View transaction ${data.hash} details on the Soroban Smart Block Explorer.`;
  }
  if (url.startsWith("/event/")) {
    return `View event #${data.seq} details on the Soroban Smart Block Explorer.`;
  }
  if (url.startsWith("/ledger/")) {
    return `View ledger #${data.seq} details on the Soroban Smart Block Explorer.`;
  }
  return "Soroban Smart Block Explorer — Decode Stellar contract events";
}

function generateJsonLd(url: string, data: any): string {
  const baseUrl = process.env.SITE_URL || "https://explorer.example.com";
  const fullUrl = `${baseUrl}${url}`;

  let jsonLdData: any = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: fullUrl,
    name: generateTitle(url, data),
    description: generateDescription(url, data),
  };

  if (url.startsWith("/contract/")) {
    jsonLdData = {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      name: data.name || `Contract ${data.id}`,
      description: data.description || "",
      codeRepository:data.id,
      url: fullUrl,
      programmingLanguage: "Rust",
      applicationCategory: "Blockchain",
    };
  }

  if (url.startsWith("/token/")) {
    jsonLdData = {
      "@context": "https://schema.org",
      "@type": "PropertyValue",
      name: data.name || data.symbol || data.id,
      description: `Token ${data.symbol || data.id} on Stellar network`,
      value: data.id,
      unitCode: data.symbol || "XLM",
      url: fullUrl,
    };
  }

  if (url.startsWith("/tx/")) {
    jsonLdData = {
      "@context": "https://schema.org",
      "@type": "FinancialTransaction",
      name: `Transaction ${data.hash}`,
      description: `Stellar transaction ${data.hash}`,
      identifier: data.hash,
      url: fullUrl,
      status: data.success ? "completed" : "failed",
    };
  }

  return `<script type="application/ld+json">${JSON.stringify(jsonLdData)}</script>`;
}
