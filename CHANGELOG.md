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

### Removed
- `indexer/tests/decoderClassic.test.js` and
  `indexer/tests/horizonClient.test.js` — both test a `horizonClient.js` API
  (`resolveToml`, `_clearCache`, TOML-based asset naming) that was removed in a
  prior refactor. To be rewritten against the current implementation.

[Unreleased]: https://github.com/Soroban-Smart-Block-Explorer/Soroban-Smart-Block/commits/main
