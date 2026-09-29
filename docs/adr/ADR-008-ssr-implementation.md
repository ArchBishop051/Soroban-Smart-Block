# ADR-008: Server-Side Rendering Implementation

- **Title:** Implement Server-Side Rendering for public detail routes
- **Status:** Proposed
- **Context:** The current SPA renders everything client-side, which causes SEO issues (search engines see empty content), poor link preview support (OpenGraph tags set too late), and slow first paint on low-end devices. We need to server-render the public detail routes (/contract/:id, /token/:id, /tx/:hash, /event/:id, /ledger/:seq) while keeping client-only features (wallets, Monaco, 3D graph) lazy-loaded.
- **Decision:** Use Vite SSR (vite-plugin-ssr) to implement server-side rendering for the specified routes. This approach:
  - Keeps the existing Vite build tooling without a full framework migration
  - Allows incremental adoption (SSR only for detail routes, SPA for others)
  - Supports streaming HTML for faster time-to-first-byte
  - Enables shared data loaders between server and client
  - Provides a migration path to full framework SSR if needed later
- **Consequences:** 
  - **Benefits:** Improved SEO, working link previews, faster first paint, better perceived performance on slow devices
  - **Tradeoffs:** Additional build complexity, need for server infrastructure, data loading complexity
  - **Mitigations:** Use Vite's SSR ecosystem, implement error boundaries for API failures, keep client-only features lazy-loaded
- **Rejected alternatives:**
  - Full framework migration to Next.js/Nuxt: Would require rewriting the entire frontend, high migration cost, disrupts existing architecture. Our current Vite + React setup is working well for the SPA use case.
  - Static site generation: Not feasible for dynamic blockchain data that changes frequently. Detail pages need fresh data from the indexer.
  - Pre-rendering at build time: Same issue as SSG - blockchain data is too dynamic. Would require frequent rebuilds.
  - No SSR (status quo): Fails SEO and link preview requirements, poor UX on slow devices.
