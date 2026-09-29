# Web Vitals Monitoring Guide

This guide explains the performance monitoring setup for the Soroban Smart Block Explorer, including CI-based Lighthouse tests, bundle size budgets, and real user monitoring (RUM) via Sentry.

## Overview

The performance monitoring system consists of three layers:

1. **CI Lighthouse Tests** - Automated performance audits on key routes
2. **Bundle Size Budgets** - Enforces size limits on JavaScript chunks
3. **Real User Monitoring (RUM)** - Collects actual user performance data via Sentry

## CI Lighthouse Tests

### Configuration

Lighthouse CI is configured in `frontend/lighthouserc.json` with the following settings:

- **Routes Tested**: home, contracts list, contract detail, event detail, wallet, search
- **Number of Runs**: 3 (median used to reduce flakiness)
- **Profile**: Desktop (mobile profile can be added for wallet routes)
- **Budgets**:
  - LCP (Largest Contentful Paint): < 2.5s
  - TBT (Total Blocking Time): < 200ms
  - CLS (Cumulative Layout Shift): < 0.1
  - FCP (First Contentful Paint): < 1.8s (warn)
  - Speed Index: < 3.4s (warn)
  - Interactive: < 3.8s (warn)

### Running Locally

```bash
# Build the frontend
cd frontend
npm run build

# Start preview server
npm run preview

# In another terminal, run Lighthouse CI
npx @lhci/cli autorun
```

### CI Integration

The `lighthouse-ci` job in `.github/workflows/ci.yml`:

1. Starts the indexer with seeded data
2. Builds the frontend
3. Starts the preview server on port 4173
4. Runs Lighthouse CI with 3 iterations
5. Uploads results as artifacts
6. Posts results as a PR comment (if `LHCI_GITHUB_APP_TOKEN` is configured)

### Required Secrets

Configure the following in GitHub repository settings:

- `LHCI_GITHUB_APP_TOKEN`: For posting Lighthouse results as PR comments

## Bundle Size Budgets

### Configuration

Bundle size budgets are defined in two places:

1. **Vite Config** (`frontend/vite.config.ts`):
   - Manual chunk splitting for better caching
   - `chunkSizeWarningLimit: 500` KB

2. **Budget Check Script** (`scripts/check-bundle-size.js`):
   - Per-chunk budgets in KB
   - PR comment with delta comparison

### Budget Limits

| Chunk | Budget (KB) |
|-------|-------------|
| index-[hash].js | 150 |
| react-vendor-[hash].js | 200 |
| query-vendor-[hash].js | 50 |
| stellar-vendor-[hash].js | 100 |
| monaco-vendor-[hash].js | 500 |
| viz-vendor-[hash].js | 300 |
| webcontainer-vendor-[hash].js | 200 |
| *-[hash].js (routes) | 100 |

### Running Locally

```bash
# Build the frontend
cd frontend
npm run build

# Check bundle sizes
node ../scripts/check-bundle-size.js
```

### CI Integration

The bundle size check runs in two CI jobs:

1. **services job**: Runs on every PR, posts PR comment with delta
2. **lighthouse-ci job**: Runs with Lighthouse tests

### Baseline Management

- On `main` branch: Current sizes are saved as baseline in `.bundle-baseline.json`
- On PRs: Current sizes are compared against baseline, delta shown in PR comment

## Real User Monitoring (RUM)

### Implementation

Web vitals are collected in `frontend/src/utils/webVitals.ts` using the `web-vitals` library:

- **Metrics Collected**: LCP, FID, CLS, INP, FCP, TTFB
- **Destination**: Sentry custom metrics
- **Environment**: Production only (development logs to console)

### Initialization

The web vitals collector is initialized in `frontend/src/main.tsx`:

```typescript
import { initWebVitals } from "./utils/webVitals";

initWebVitals();
```

### Sentry Dashboard Setup

To view web vitals in Sentry:

1. Navigate to your Sentry project
2. Go to **Performance** → **Metrics**
3. Filter by metric names:
   - `LCP`
   - `FID`
   - `CLS`
   - `INP`
   - `FCP`
   - `TTFB`
4. Create dashboards for:
   - Core Web Vitals overview
   - Route-specific performance
   - Percentile distributions (p50, p75, p95)

### Budget Thresholds

The following thresholds are used for rating metrics:

| Metric | Good | Needs Improvement |
|--------|------|-------------------|
| LCP | < 2.5s | < 4s |
| FID | < 100ms | < 300ms |
| CLS | < 0.1 | < 0.25 |
| INP | < 200ms | < 500ms |
| FCP | < 1.8s | < 3s |
| TTFB | < 800ms | < 1.8s |

## Comparing CI vs RUM Data

### Why Both Are Needed

- **CI Lighthouse**: Synthetic, controlled environment, catches regressions before deployment
- **RUM**: Real user data, reflects actual network conditions and device diversity

### Expected Differences

RUM data will typically show:

- Higher LCP due to slower networks
- Higher TBT due to lower-end devices
- More variance due to real-world conditions

### Investigation Workflow

1. **CI Fails**: Fix before merge - this is a regression
2. **CI Passes but RUM Degrades**: Investigate real-world factors (CDN, third-party scripts, device-specific issues)
3. **Both Degrade**: Critical performance regression requiring immediate attention

## Troubleshooting

### Lighthouse CI Fails

1. Check the uploaded artifact in the CI run
2. Look at specific metric failures
3. Use Chrome DevTools Lighthouse locally to reproduce
4. Common fixes:
   - Lazy load heavy components
   - Optimize images
   - Reduce JavaScript bundle size
   - Improve server response time

### Bundle Size Check Fails

1. Check the PR comment for the violating chunk
2. Use `vite-bundle-visualizer` to analyze:
   ```bash
   npm run build -- --mode=production
   npx vite-bundle-visualizer
   ```
3. Common fixes:
   - Move large dependencies to separate chunks
   - Use dynamic imports for route-specific code
   - Remove unused dependencies
   - Tree-shake libraries properly

### RUM Shows Degradation

1. Check Sentry release correlation
2. Filter by geography, device type, browser
3. Look for third-party script impact
4. Check CDN performance
5. Verify no network issues at the time

## Adding New Routes to Lighthouse CI

To add a new route to the Lighthouse CI tests:

1. Edit `frontend/lighthouserc.json`
2. Add the URL to the `ci.collect.url` array
3. For wallet-connected routes, add a separate mobile profile configuration

## Adjusting Budgets

To adjust bundle size budgets:

1. Edit `scripts/check-bundle-size.js`
2. Update the `BUDGETS` object
3. Document the reason for the change in a PR

To adjust Lighthouse budgets:

1. Edit `frontend/lighthouserc.json`
2. Update the `ci.assert.assertions` object
3. Document the reason for the change in a PR

## References

- [Web Vitals](https://web.dev/vitals/)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [Sentry Performance Monitoring](https://docs.sentry.io/platforms/javascript/performance/)
- [Vite Bundle Analysis](https://github.com/btd/rollup-plugin-visualizer)
