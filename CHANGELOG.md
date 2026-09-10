# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **CI:** `indexer` dependency install (`npm ci`) failed on a non-existent
  `@stryker-mutator/command-runner` package and a `package-lock.json` that was
  out of sync with `package.json`. Removed the bogus dependency and regenerated
  the lockfile.
- **CI:** Contract test suite (`cargo test -p soroban-explorer-contract`,
  `cargo clippy --all-targets`, `cargo llvm-cov`) failed to compile —
  `contracts/explorer/tests/proptest.rs` had not been updated after
  `get_contract` changed to return `Result` and take `&BytesN<32>`, and one
  property test registered a contract as a non-admin and asserted an invariant
  that did not hold for all generated inputs.
- **CI:** Frontend `tsc` (and therefore `npm run build`) failed —
  `Nav.tsx` used `WalletConnectButton` without importing it, and
  `hooks/useFreighter.ts` used a removed `@stellar/freighter-api` API surface.
- **CI:** `frontend/test/WalletPage.test.tsx` asserted a button label
  (`↓ Export CSV`) that no longer exists (`ExportButton` renders `↓ Export`).
- **CI:** Database migrations failed on a fresh database —
  `031_multi_network_support.sql` referenced tables that are never created
  (`contract_invocations`, `verified_contracts`); corrected to the real table
  names (`sub_invocations`, `source_verifications`) and made every
  `ADD COLUMN` idempotent.
- **CI:** `indexer` `npm run test:coverage` crashed on a missing dependency —
  `src/tracing.js` imports `@opentelemetry/*` packages that were never added to
  `package.json`. Added them.
- **OpenAPI:** `docs/api/openapi.yaml` failed `swagger-cli validate`
  (`type: [integer, "null"]` is 3.1 syntax in a 3.0 spec) and `redocly lint`
  (undefined `MetricsApiKeyAuth` security scheme). Both fixed; the committed
  Postman collection was regenerated to clear pre-existing drift.
- **Bug:** `indexer/src/db.js` had three duplicate object keys
  (`getContractStats`, `getRecentLedgers`, `insertGapLog`); the shadowed
  (dead) definitions were removed.
- **Bug:** `indexer/test/csrf.test.js` and
  `indexer/test/security/sql-injection.test.js` contained syntax errors
  (`await` in a non-async function; a whole second test file concatenated on).
- **CI / Runtime:** the indexer crashed on startup (`db.init()` →
  `42P10: no unique or exclusion constraint matching the ON CONFLICT
  specification`). Migration `031_multi_network_support.sql` moved the primary
  keys of `daemon_state` and `ledger_hashes` to `(network, key)` /
  `(network, ledger)`, but `src/db.js` still upserted on the old single-column
  targets. All daemon-cursor and ledger-hash reads/writes are now network-scoped
  via `getIndexerNetwork()`. The same stale `ON CONFLICT (key)` was fixed in
  `test/api/api.test.js`, `test/api/reorg-acceptance.test.js`, and
  `test/reorgWorker.test.js`. This unblocks the `k6-pr-baseline` and
  `visual-regression` jobs, which start a real indexer.
- **CI:** the frontend dev server (`npm run dev`, used by the
  `visual-regression` Playwright job) failed to boot — `frontend/package.json`
  pinned `overrides.esbuild` to `^0.28.1` while Vite 6 expects `^0.25.0`, and
  esbuild 0.28 turns several dependency-prebundle transforms into hard errors.
  Pinned esbuild to `^0.25.0` and added it as an explicit `devDependency` so
  `vite-plugin-monaco-editor`'s bare `require("esbuild")` still resolves.
- **CI:** the `visual-regression` job could never pass — `playwright.config.ts`
  sets `testDir: ./test/playwright` but the spec lives in `test/visual/`, so
  `playwright test test/visual/...` matched zero tests (exit 1); there are no
  committed baseline snapshots; and the job exported `NODE_ENV=test`, under
  which the indexer API never calls `listen()`. Added
  `playwright.visual.config.ts` (testDir `./test/visual`),
  `updateSnapshots: "missing"` + a screenshot pixel tolerance, and pinned the
  indexer web server to `NODE_ENV=development`.
- **CI:** the `k6-pr-baseline` job could never pass — `apt-get install k6`
  fails (k6 is not in the Ubuntu apt repos), `NODE_ENV=test` kept the API from
  binding a port, and the per-client rate limiter turned the load run into a
  wall of 429s. k6 is now fetched as a released binary, the indexer runs with
  `NODE_ENV=development`, and a new `RATE_LIMITING_DISABLED` env var (honoured
  only by `src/api.js`, load-harness use only) skips the throttling middleware.

### Removed
- `indexer/tests/decoderClassic.test.js` and
  `indexer/tests/horizonClient.test.js` — both test a `horizonClient.js` API
  (`resolveToml`, `_clearCache`, TOML-based asset naming) that was removed in a
  prior refactor. To be rewritten against the current implementation.

[Unreleased]: https://github.com/Soroban-Smart-Block-Explorer/Soroban-Smart-Block/commits/main
