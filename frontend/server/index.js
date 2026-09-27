import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { sitemapMiddleware } from "./sitemap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === "development";
const PORT = process.env.PORT || 3000;

async function createServer() {
  const app = express();

  // Serve sitemap.xml
  app.get("/sitemap.xml", sitemapMiddleware);

  // API proxy in development
  if (isDev) {
    app.use("/api", (req, res) => {
      // Proxy to indexer
      res.redirect(`http://localhost:3001${req.originalUrl}`);
    });
  }

  let vite;
  if (isDev) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve static files
    app.use(express.static(path.resolve(__dirname, "../dist/client")));
  }

  // SSR handler for detail routes
  app.use("*", async (req, res) => {
    const url = req.originalUrl;

    // Check if this is a detail route that should be SSR'd
    const ssrRoutes = [
      /^\/contract\/.+/,
      /^\/token\/.+/,
      /^\/tx\/.+/,
      /^\/event\/.+/,
      /^\/ledger\/.+/,
    ];

    const isSSRRoute = ssrRoutes.some((regex) => regex.test(url));

    if (!isSSRRoute) {
      // For non-SSR routes, serve the SPA
      if (isDev) {
        // In dev, let Vite handle it
        return vite.transformIndexHtml(url, fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf-8"));
      } else {
        // In prod, serve index.html
        return res.sendFile(path.resolve(__dirname, "../dist/client/index.html"));
      }
    }

    try {
      let template;
      let render;

      if (isDev) {
        template = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        render = (await vite.ssrLoadModule("/src/entry-server.tsx")).render;
      } else {
        template = fs.readFileSync(path.resolve(__dirname, "../dist/client/index.html"), "utf-8");
        render = (await import("../dist/server/entry-server.js")).render;
      }

      const appHtml = await render(url, template);

      res.status(200).set({ "Content-Type": "text/html" }).end(appHtml);
    } catch (e) {
      vite?.ssrFixStacktrace(e);
      console.error("SSR Error:", e);
      
      // On API failure, render a meaningful error shell
      // This ensures crawlers still get a proper page structure
      const errorHtml = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Soroban Smart Block Explorer</title>
            <meta property="og:type" content="website" />
            <meta property="og:site_name" content="Soroban Smart Block Explorer" />
            <meta property="og:title" content="Soroban Smart Block Explorer" />
            <meta property="og:description" content="Decode Stellar contract events" />
          </head>
          <body>
            <div id="root">
              <div style="padding: 2rem; max-width: 800px; margin: 0 auto; font-family: system-ui, sans-serif;">
                <h1>Service Temporarily Unavailable</h1>
                <p>We're experiencing technical difficulties. Please try again later.</p>
                <p>The page will load with full functionality once the service is restored.</p>
              </div>
            </div>
            <script type="module" src="/src/entry-client.tsx"></script>
          </body>
        </html>
      `;
      
      res.status(503).set({ "Content-Type": "text/html", "Retry-After": "60" }).end(errorHtml);
    }
  });

  app.listen(PORT, () => {
    console.log(`SSR server running at http://localhost:${PORT}`);
  });
}

createServer();
