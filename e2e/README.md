# End-to-End Testing Suite

Comprehensive E2E test framework for the Soroban Smart Block Explorer. Validates the full pipeline: **Stellar events → indexer → DB → API → frontend**.

## Quick Start

```bash
cd e2e
npm install

# Run all E2E tests (API, chaos, property, browser)
npm run test:e2e

# Run individual test suites
npm run test:api           # API integration tests
npm run test:chaos         # Chaos engineering (fault injection)
npm run test:property      # Property-based tests (fast-check)
npm run test:playwright    # Browser automation (3 browsers + mobile)
npm run test:k6            # Load testing (baseline 100 req/s)

# Advanced tests
npm run test:synthetic     # Synthetic production event monitoring
npm run test:visual        # Visual regression (Percy)
npm run test:full          # Everything (takes 4+ hours with soak test)
```

## Architecture

```
e2e/
├── test/
│   ├── api/                  # Integration tests (Node.js)
│   ├── chaos/                # Fault injection scenarios
│   ├── property/             # Property-based tests (fast-check)
│   ├── playwright/           # Browser E2E tests
│   ├── load/                 # k6 performance tests
│   ├── synthetic/            # Production event monitoring
│   └── visual/               # Percy visual regression
├── playwright.config.ts      # Playwright configuration
├── vitest.config.ts          # Vitest configuration for property tests
└── package.json              # Dependencies and scripts
```

## Test Suites

### 1. API Integration Tests (`test/api/integration.test.js`)

**Type:** Node.js native tests (node:test)
**Duration:** ~2 minutes
**Coverage:** Full pipeline from HTTP request → DB query → response

**Tests:**

- ✅ GET /api/contracts - paginated results
- ✅ GET /api/contracts/:id - contract details
- ✅ GET /api/contracts/:id/events - event pagination
- ✅ Event decoding - correct XDR → JSON transformation
- ✅ Idempotency - replaying events produces same state
- ✅ Pagination correctness with various page sizes
- ✅ Concurrent request safety (10 parallel requests)
- ✅ Health check endpoint

**Acceptance Criteria:**

- All tests pass
- No race conditions detected
- API returns consistent data across repeated calls

---

### 2. Chaos Engineering (`test/chaos/fault-injection.test.js`)

**Type:** Controlled failure injection
**Duration:** ~5 minutes
**Validates system resilience under stress**

**Scenarios:**

| Scenario           | Trigger                      | Expected Behavior                                  |
| ------------------ | ---------------------------- | -------------------------------------------------- |
| RPC Node Down      | Network timeout              | Circuit breaker activates, retries with backoff    |
| DB Connection Lost | Connection pool exhaustion   | Reconnect with exponential backoff (1s, 2s, 4s...) |
| Disk Full          | DB storage limit             | Graceful degradation, alerts fired                 |
| Network Partition  | Service isolation            | Eventual consistency on reconnection               |
| Clock Skew > 30s   | Timestamp anomaly            | Reject out-of-range events                         |
| OOM Kill           | Memory pressure              | Graceful restart, cursor recovery                  |
| Cascading Failures | Multiple simultaneous faults | Partial service availability                       |

**Test Automation:**

- Log monitoring for circuit breaker activation
- DB reconnection with timing verification
- Simulated network partitions (iptables)
- Timestamp validation and rejection
- Cursor persistence checks
- No duplicate events after recovery

---

### 3. Property-Based Tests (`test/property/pipeline.test.js`)

**Type:** Property-based with fast-check
**Duration:** ~10 minutes (50-100 generated tests)
**Validates invariants across random inputs**

**Properties:**

| Property               | Description                                    | Fast-Check Coverage           |
| ---------------------- | ---------------------------------------------- | ----------------------------- |
| Pagination Correctness | Valid page/offset always returns valid results | 50 random (page, limit) pairs |
| Event Decoding         | All decoded events have required fields        | 20 random page/limit combos   |
| Idempotency            | Same query always returns same result          | 10 repeated calls per seed    |
| Concurrent Safety      | No race conditions in API handlers             | 20 concurrent request sets    |
| Timestamp Validity     | All event timestamps are valid dates           | 100 random event samples      |
| Field Consistency      | Contract fields consistent across calls        | Random contract selections    |
| No Null Fields         | API responses never have null/undefined        | Recursive deep check          |
| Ledger Monotonicity    | Event ledger numbers increase per contract     | Random event order checks     |

**Acceptance Criteria:**

- 100% of generated properties pass
- No false positives in 50+ runs per property
- Coverage of edge cases (empty pages, boundary values)

---

### 4. Browser E2E Tests (`test/playwright/main.spec.ts`)

**Type:** Playwright browser automation
**Duration:** ~10 minutes (all browsers + mobile)
**Browsers:** Chrome, Firefox, Safari, Mobile Chrome (Pixel 5), Mobile Safari (iPhone 14)

**Core Workflows:**

- Load homepage
- Browse contracts list
- View contract details
- Filter events by type
- Search functionality
- Pagination navigation
- Circuit breaker status display
- Event details modal
- Responsive design (mobile layout)
- Dark mode toggle
- Error handling (invalid contract ID)
- Full-text search across 10,000+ events

**Advanced Scenarios:**

- Contract upgrade flow: old ABI → new ABI
- Multi-network comparison: testnet vs mainnet
- Wallet connection (Freighter)
- Sandbox contract call submission

**Responsive Breakpoints:**

- Mobile (375x667)
- Tablet (768x1024)
- Desktop (1280x800)
- Widescreen (1920x1080)

**Acceptance Criteria:**

- ✅ All 3 desktop browsers pass core workflows
- ✅ Mobile Chrome (Pixel 5) responsive design verified
- ✅ Mobile Safari (iPhone 14) responsive design verified
- ✅ Tests complete in < 10 minutes
- ✅ < 5% flakiness

---

### 5. Performance & Load Testing (`test/load/`)

**Type:** k6 scripting language
**Duration:** 5 min (baseline) + 50 sec (spike) + 4 hours (soak)

#### 5a. Baseline Test (`baseline.js`)

**Target:** 100 req/s for 5 minutes

```
VUs:          50
Duration:     5 minutes
Expected:     p50 < 100ms, p95 < 500ms, p99 < 2s
Error Rate:   < 10%
```

**Endpoints Tested:**

- GET /api/contracts (list with pagination)
- GET /api/contracts/:id (details)
- GET /api/contracts/:id/events (events)
- GET /health (health check)

#### 5b. Spike Test (`spike.js`)

**Target:** 0 → 2000 req/s in 10 seconds

```
Ramp-up:      10 seconds to 2000 VUs
Sustain:      30 seconds at peak
Ramp-down:    10 seconds to 0
Total:        50 seconds
```

**Validates:** System can handle sudden traffic bursts

#### 5c. Soak Test (`soak.js`)

**Target:** 200 req/s for 4 hours

```
VUs:          200
Duration:     4 hours
Ramp-up:      10 minutes
Ramp-down:    5 minutes
```

**Validates:** Memory leaks, connection pool exhaustion, stability

**Acceptance Criteria:**

- ✅ Baseline: p95 < 500ms, p99 < 2s, error rate < 10%
- ✅ Spike: no cascading failures, graceful degradation
- ✅ Soak: no memory growth > 10%, connection pool stable

---

### 6. Synthetic Production Monitoring (`test/synthetic/producer.js`)

**Type:** Production event injection
**Duration:** Continuous (runs as cron job)
**SLA:** Events appear in explorer within 30 seconds

**Flow:**

1. Generate synthetic contract event
2. Submit to Soroban RPC (testnet/mainnet)
3. Poll explorer API for event detection
4. Measure latency and SLA compliance
5. Alert if SLA breached

**Metrics Collected:**

- Event submission timestamp
- Event detection timestamp
- E2E latency (p50, p95, p99)
- SLA compliance percentage
- Failure reasons (RPC timeout, event not indexed, etc.)

**Acceptance Criteria:**

- ✅ ≥ 95% of synthetic events detected within SLA
- ✅ p50 latency < 5 seconds
- ✅ p95 latency < 30 seconds
- ✅ Alerts fired for SLA breaches

---

### 7. Visual Regression Testing (`test/visual/percy.spec.ts`)

**Type:** Percy pixel-perfect comparison
**Duration:** ~15 minutes
**Regression Threshold:** 0.1%

**Snapshots (Responsive):**

- Homepage (mobile, tablet, desktop, widescreen)
- Contract details page (desktop, mobile)
- Circuit breaker component
- Event table
- Pagination controls
- Error states (404, loading)
- Dark mode homepage
- Responsive grid (6 breakpoints: 320px–1920px)

**Interaction States:**

- Button hover states
- Form focus states
- Modal/dialog open state

**Acceptance Criteria:**

- ✅ All snapshots approved
- ✅ No visual regressions > 0.1%
- ✅ Responsive design verified at all breakpoints
- ✅ Dark mode contrast meets WCAG AA

---

## Workload Scenarios (local network)

`workloads/` holds a seeded workload generator that drives realistic traffic
through a local `stellar/quickstart` network and records what the indexer should
end up with.

| File | Purpose |
|------|---------|
| `workloads/dsl.ts` | Step/expectation types, seeded PRNG (mulberry32), `WorkloadBuilder` |
| `workloads/scenarios.ts` | Scenario library: setup, token lifecycle (SAC), failures, explorer registry, ticket, upgrade, TTL extend + restore, fee bump + multi-auth, AMM/NFT/lending/smart-wallet, bursts |
| `workloads/run.ts` | Executes the plan with the `stellar` CLI and writes `workloads/manifest.json` |
| `test/workloads/manifest.test.js` | Asserts indexed/decoded events for every scenario against the manifest |

```bash
docker compose up -d stellar-quickstart postgres indexer   # from the repo root
cargo build --target wasm32-unknown-unknown --release -p soroban-explorer-contract
(cd ../contracts/ticket && cargo build --target wasm32-unknown-unknown --release)
make e2e-scenarios                     # WORKLOAD_SEED=42 by default
npx tsx workloads/run.ts --seed 7 --dry-run   # print the plan without submitting
```

- **Determinism:** the same seed always produces the same steps and amounts.
- **Assertions are content-based** (contract, event name, minimum count), never
  ledger numbers, so ledger timing variance does not cause flakes.
- **Optional contracts:** AMM, NFT, lending mock, smart wallet, custom SEP-41 and
  upgradable contracts are not built in this repo. Point
  `WORKLOAD_WASM_{AMM,NFT,LENDING,WALLET,TOKEN,UPGRADABLE}` at WASM files to
  enable those scenarios; otherwise they are recorded as skipped in the manifest.
- **Environment:** `WORKLOAD_RPC_URL` (default `http://localhost:8000/soroban/rpc`),
  `WORKLOAD_PASSPHRASE`, `INDEXER_URL`, `WORKLOAD_INDEX_TIMEOUT_MS`.
- **CI:** the `workload-scenarios` job in `.github/workflows/e2e-nightly.yml`
  runs nightly with a 15-minute budget for the scenario step.

## Setup & Configuration

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Required variables:

```env
INDEXER_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
DATABASE_URL=postgres://soroban:soroban_secret@localhost:5432/soroban_explorer
```

Optional (for advanced tests):

```env
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
PERCY_TOKEN=<your-percy-token>
K6_RESULTS_DIR=./k6-results
```

### Local Development

**Prerequisites:**

- Node.js 20+
- PostgreSQL 16+ (running)
- Indexer service running on 3001
- Frontend service running on 5173

**Start local environment:**

```bash
# Terminal 1: Start indexer
cd ../indexer
npm install
npm start

# Terminal 2: Start frontend
cd ../frontend
npm install
npm run dev

# Terminal 3: Run E2E tests
cd ../e2e
npm install
npm run test:e2e
```

Or use Docker Compose:

```bash
# From project root
docker-compose --profile test up -d

# Wait for services to be healthy
sleep 10

# Run E2E tests
cd e2e
npm run test:e2e
```

---

## CI/CD Integration

E2E tests run automatically on every PR:

1. **On PR open/synchronize:**
   - API integration tests (2 min)
   - Chaos engineering (5 min)
   - Property-based tests (10 min)
   - Playwright browser tests (10 min)
   - ⏭️ Skip k6/synthetic/visual (long-running)

2. **On merge to main:**
   - All tests above +
   - k6 baseline test (5 min)
   - Synthetic event monitoring

3. **Nightly cron:**
   - k6 spike test (50 sec)
   - k6 soak test (4 hours)
   - Percy visual regression

### Artifacts

Test results uploaded to GitHub Actions:

- `playwright-report/` - Playwright HTML report
- `e2e-test-results/` - Test result JSONs
- `e2e-logs.tar.gz` - Service logs on failure

### Failure Handling

Tests automatically retry on transient failures:

- Playwright: 2 retries (CI only)
- Node tests: immediate fail (no retries)
- k6: fail threshold at 10% error rate

---

## Performance Baselines

Current targets (update as system improves):

| Metric            | Target           | Threshold    |
| ----------------- | ---------------- | ------------ |
| API p50 latency   | < 100ms          | p95 < 500ms  |
| API p99 latency   | < 2s             | max 5s       |
| API error rate    | < 1%             | max 10%      |
| Spike handling    | graceful         | no crashes   |
| Soak stability    | zero memory leak | < 10% growth |
| Synthetic SLA     | 95% in 30s       | min 80%      |
| Visual regression | 0 diffs          | max 0.1%     |

---

## Troubleshooting

### Tests hang or timeout

**Problem:** Tests wait forever for service to start
**Solution:**

```bash
# Verify services are running
curl http://localhost:3001/health
curl http://localhost:5173

# Check ports not in use
lsof -i :3001
lsof -i :5173
```

### Playwright can't find browsers

**Problem:** "Executable doesn't exist at..." error
**Solution:**

```bash
# Install browsers
npx playwright install
```

### Database connection errors

**Problem:** "Failed to connect to postgres"
**Solution:**

```bash
# Verify DB is running
docker ps | grep postgres

# Check connection string in .env
echo $DATABASE_URL

# Reset DB
docker-compose --profile test down -v
docker-compose --profile test up postgres -d
sleep 5
```

### k6 tests fail with status 502

**Problem:** "HTTP 502 Bad Gateway"
**Solution:**

- Increase load gradually (reduce VUs in k6 script)
- Check indexer memory usage: `docker stats`
- Verify DB connection pool not exhausted

### Percy visual regressions

**Problem:** "Percy snapshot differs from baseline"
**Solution:**

1. Review diff on https://percy.io
2. If intentional, approve new baseline
3. If regression, fix CSS and re-run

---

## Extending Tests

### Adding a new API test

Create `e2e/test/api/my-feature.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert";
import fetch from "node-fetch";

const BASE_URL = process.env.INDEXER_URL || "http://localhost:3001";

test("My Feature - Description", async (t) => {
  await t.test("specific test case", async () => {
    const res = await fetch(`${BASE_URL}/api/my-endpoint`);
    assert.strictEqual(res.status, 200);
  });
});
```

Run it:

```bash
npm run test:api
```

### Adding a Playwright test

Create `e2e/test/playwright/my-feature.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

test("My Feature", async ({ page }) => {
  await page.goto("http://localhost:5173");
  await expect(page.locator("text=My Feature")).toBeVisible();
});
```

Run it:

```bash
npm run test:playwright
```

### Adding a k6 load test

Create `e2e/test/load/my-load-test.js`:

```javascript
import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 100,
  duration: "5m",
};

export default function () {
  const res = http.get("http://localhost:3001/api/my-endpoint");
  check(res, { "status 200": (r) => r.status === 200 });
}
```

Run it:

```bash
k6 run test/load/my-load-test.js
```

---

## Monitoring & Alerts

### Track E2E Health

Dashboard showing:

- Test pass rate (%) by suite
- API latency trends (p50, p95, p99)
- Error rate timeline
- Synthetic event SLA compliance
- Visual regression baseline drift

**View in:** GitHub Actions → E2E Tests job → Summary

### Alert Conditions

Failing tests auto-create GitHub issues:

- ❌ E2E API tests failing → Issue: "E2E: API Integration Failed"
- ❌ Chaos test fails → Issue: "E2E: Resilience Test Failed"
- ❌ Playwright tests fail → Issue: "E2E: Browser Tests Failed"
- ❌ k6 spike test fails → Issue: "E2E: Load Test Failed"
- ❌ Synthetic SLA breached → Issue: "E2E: Production SLA Missed"
- ❌ Visual regression > 0.1% → Issue: "E2E: Visual Regression Detected"

---

## References

- [Playwright Documentation](https://playwright.dev)
- [k6 Documentation](https://k6.io/docs)
- [fast-check (property-based testing)](https://github.com/dubzzz/fast-check)
- [Percy (visual testing)](https://docs.percy.io)
- [Stellar Soroban](https://developers.stellar.org/learn/smart-contracts)

---

## Questions?

See [`docs/`](../docs) for more info on:

- Architecture overview
- Deployment strategy
- Monitoring & observability
- Contributing guidelines
