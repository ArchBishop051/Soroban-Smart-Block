# Production-Readiness Audit — Soroban Smart Block Explorer ("Stellar Drip Wave")

**Date:** 2026-09-07
**Auditor:** automated full-repo audit (Claude)
**Scope:** entire monorepo — contracts, indexer, frontend, api, packages, e2e, CI/CD, docs, docker
**Method:** static read of all subsystems + toolchain baseline (Node 24, Rust 1.98 + wasm32, PostgreSQL 16) — every build/lint/test/CI entrypoint was actually executed.

> This is an assessment + plan only. **No application code was changed.** The working tree is clean.

---

## 1. Verdict

The project's **core concept is sound and its smart contract is genuinely well-built.** However, the repository as it stands **cannot pass CI and would very likely be rejected again**, for two independent classes of reason:

1. **CI is red across almost every job** — not "flaky", but hard-broken: the indexer's dependencies don't install, the contract test suite doesn't compile, and the frontend doesn't type-check. Details in §3.
2. **Scope incoherence / inflation signals.** The submission manifest (`docs/MANIFEST.md`) describes a focused MVP (~5 features). The repo is a **~38,000-LOC, 200+-file monorepo** with Stripe billing, Kafka event bus, GeoIP rate-limiting, ZK host-function decoding, a 3D dependency graph, a WebContainer IDE, k6 load gates, Stryker mutation testing, and Kani proofs. A reviewer cannot map this to the pitch, and several parts read as padding. Piling on *more* tooling makes this worse, not better.

There is also a **structural red flag** that likely contributed to the "unknown reason": the entire repository is **a single squashed commit** (`git rev-list --count HEAD` = 1), no tags, no branches. For a project referencing PR #842, a one-commit history makes contribution and authorship unverifiable and looks like history laundering.

**Recommendation: trim to a coherent, demonstrably-working MVP** (Option A from the kickoff questions), then harden that. A smaller surface that builds, tests green, runs in one command, and matches the manifest will survive review. The current surface will not, no matter how much polish is applied.

---

## 2. Architecture (as-built)

| Layer | Path | Language | State |
|---|---|---|---|
| Smart contracts | `contracts/explorer`, `contracts/ticket` | Rust / Soroban SDK 21 | **Contract code: good.** Test targets broken. |
| Indexer + REST/GraphQL/WS API | `indexer/` (81 src modules, ~16k LOC) | Node.js (ESM) | Builds conceptually; **deps won't install**, tests non-hermetic, huge scope creep |
| Second API implementation | `api/` (~15 files) | Node.js | **Orphaned dead code** — nothing imports it, no `package.json`, duplicates `indexer/src/api.js` |
| Frontend SPA | `frontend/` (132 src files, ~21k LOC) | React 18 + Vite + TS | **`tsc` fails** → build fails; 1 test fails; lint config neutered |
| Client libraries | `packages/{client,sdk,cli}` | JS / TS | Lightly tested; stale dep pins (`vitest ^1`) |
| E2E / load / chaos | `e2e/` | Playwright, k6, fast-check, Percy | Enormous; not run in blocking CI |
| Docs site | `docs/` (50 files) | Markdown + static HTML | Extensive; partly stale/aspirational |
| Local orchestration | `docker-compose*.yml`, `Makefile` | — | **Does not come up cleanly** (credential mismatch, wrong Dockerfiles, no migrate step) |

**Data flow (the real product):** Soroban RPC `getEvents()` → `indexer/src/decoder.js` (XDR → human text via ABI registry) → PostgreSQL → Express REST API → React feed. Everything else is an accretion around this spine.

---

## 3. CI/CD status — why it fails today

Every entry below was reproduced locally against a clean toolchain.

| CI job / step | Result | Root cause |
|---|---|---|
| `ci.yml` → **services** → `npm ci` (indexer) | ❌ **FAIL** | `indexer/package.json` declares `@stryker-mutator/command-runner@^8.7.1` — **this package does not exist on npm** (404). `indexer/package-lock.json` doesn't contain it either, so **`npm ci` fails on lockfile drift regardless.** |
| `ci.yml` → **services** → "Lockfile drift check" | ❌ **FAIL** | Same drift: `package.json` and `package-lock.json` disagree. |
| `ci.yml` → **migrations** → `node src/migrate.js` (blank PG 16) | ❌ **FAIL** | `031_multi_network_support.sql` references `relation "contract_invocations"` which does not exist at that point. The `.js` migrations (`019`, `029`, `030`) are **silently skipped** by `migrate.js` (it only processes `.sql`), so the chain is broken on a fresh DB. Also two files numbered `028` (`028_webhooks.sql`, `028_contract_events_daily_index.sql`, `028_create_sandboxes.sql`, `028_token_holders_if_not_exists_guard.sql` — four `028`s). |
| `ci.yml` → **contracts** → `cargo clippy --all-targets -- -D warnings` | ❌ **FAIL** | `contracts/explorer/tests/proptest.rs` — **9 compile errors**. `get_contract` was changed to `-> Result<ContractMeta, Error>` taking `&BytesN<32>`; the proptest still calls `.unwrap()` on the meta and passes an owned `cid`. |
| `ci.yml` → **contracts** → `cargo llvm-cov` (explorer, 80% gate) | ❌ **FAIL** | Same — the test binary doesn't compile, so coverage can't run. |
| `ci.yml` → **frontend-tests** → `npm test -- --coverage` | ❌ **FAIL** | `frontend/test/WalletPage.test.tsx:266` — `findByText("↓ Export CSV")` times out. 182/183 tests pass; 1 hard failure fails the job. |
| `ci.yml` → **services** → `npm run build` (frontend) | ❌ **FAIL** | `tsc` exits 2: `Nav.tsx:280` uses `WalletConnectButton` with no import; `hooks/useFreighter.ts` uses `@stellar/freighter-api`'s old API (`getPublicKey` no longer exported; `getNetwork()` return type changed). `build = tsc && vite build`, so `vite build` never runs. |
| `ci.yml` → **services** → `npm run test:coverage` (indexer) | ❌ **FAIL** | Exits 1. Also: this step **only runs 4 of ~140 test files** and reports coverage for **one 271-line file** (`scval.js`, 92.6%). `decoderClassic.test.js` and `horizonClient.test.js` fail because they hit the **real Horizon API over the network**. |
| `ci.yml` → **visual-regression**, **k6-pr-baseline** | ❌ **FAIL** (cascade) | Both `npm ci` the indexer first → same install failure. |
| `docker-indexer.yml` build | ❌ **FAIL** (when triggered) | `Dockerfile` runs `npm ci --omit=dev` → same lockfile drift failure. |
| `docker-frontend.yml` build | ❌ **FAIL** (when triggered) | `npm run build` → `tsc` failure. |
| `deploy.yml` | ⚠️ **Theatre** | Every deploy/canary/blue-green/rollback step is `echo "In a real deployment: ..."`. `release` job reads `CHANGELOG.md` — **the file does not exist**. `slackapi/slack-github-action@v1` is deprecated (v4 is current; `ci.yml` already uses `@v2.1.0`), but those steps are `continue-on-error` so they don't fail the job. (The action version pins `docker/setup-qemu-action@v4` and `softprops/action-gh-release@v3` **do** resolve — an earlier draft of this audit wrongly flagged them.) |
| `ci.yml` → **contracts** → `cargo fmt --check` | ✅ pass | |
| `ci.yml` → **contracts** → `cargo build --target wasm32` | ✅ pass | wasm compiles cleanly in ~2m. |
| `ci.yml` → **secret-scan** (gitleaks) | ✅ pass (no secrets committed) | |
| `ci.yml` → **frontend eslint** (via pre-push only) | ⚠️ near-noop | See §6. |

### Linting is not in CI at all
ESLint / Prettier run **only in `.husky/pre-push`**, which is bypassable (`--no-verify`) and never runs on GitHub. There is **no lint job** in any workflow. `pr-quality.yml` only checks branch names and PR size.

Running ESLint on the indexer today: **1,398 errors across 67 files.** Most (`1,346 × no-undef`) are a **config gap** — the flat config declares no test-runner or `globalThis`/`process`-family globals — but buried in the noise are **real bugs** (§5).

---

## 4. Security

| Severity | Finding |
|---|---|
| High | `npm audit`: **5 vulns in indexer, 5 in frontend.** Headline: `@stellar/stellar-sdk` (indexer `^14.6.1`, frontend pinned `12.3.0`) pulls a vulnerable `toml` (`GHSA-v5mp-jgw5-2x6j` prototype pollution, `GHSA-82x6-q7mm-w9cf` uncontrolled recursion). Clean fix needs `@stellar/stellar-sdk@17` (breaking). |
| High | **Two different `@stellar/stellar-sdk` majors** in one repo: indexer 14, frontend 12, e2e 12, MANIFEST claims 12. Pick one. |
| Medium | `config.js` fails fast if `API_KEY` unset in production (good), but the same file documents that `requireApiKey()` **fails open** — worth re-reading the auth middleware in `indexer/src/api.js` to confirm the guard actually covers every write route it claims to. |
| Medium | Admin auth is a single bearer `ADMIN_SECRET` + optional TOTP. For a public explorer with `/api/admin/*`, `/api/verify`, `/api/simulate`, `/api/sandbox/simulate` this is thin. Sandbox simulation against a real source account (`SIMULATE_SOURCE`) is an abuse vector. |
| Low | `.env.example` contains junk (`#vdhv` on line 14) and a hard-coded real testnet `EXPLORER_CONTRACT_ID`. |
| Low | `.env.example` `DATABASE_URL` (`postgres:postgres`) contradicts `docker-compose.yml` (`soroban:soroban_secret`) despite a comment claiming they match. Same secret string (`soroban_secret`) is hard-coded in compose, devcontainer, and CI. |
| Info | No `SECURITY.md`, no documented disclosure process. CodeQL is configured (js/ts only — no Rust). Trivy runs only in the two Docker workflows. |

No secrets are committed (gitleaks clean). `helmet`, `cors`, `express-rate-limit` are wired in the indexer.

---

## 5. Real bugs found (independent of scope decisions)

| File | Bug |
|---|---|
| `indexer/src/db.js` | **Three duplicate object keys** — `getContractStats` (line ~1073), `getRecentLedgers` (~1750), `insertGapLog` (~1762). The second definition silently shadows the first. At least one pair is likely behaviourally different. |
| `indexer/test/csrf.test.js:8` | **Syntax error** — top-level `await` outside an async function. This test file cannot parse or run. |
| `indexer/test/security/sql-injection.test.js:113` | **Syntax error** — `request` redeclared in the same scope. The SQL-injection test file cannot run. |
| `indexer/test/batch.test.js:442` | `no-constant-binary-expression` — a constant on the LHS of `||`; the assertion is always truthy and tests nothing. |
| `contracts/explorer/tests/proptest.rs` | 9 compile errors from `get_contract` signature drift (see §3). |
| `frontend/src/components/Nav.tsx:280` | `WalletConnectButton` referenced, never imported. |
| `frontend/src/hooks/useFreighter.ts` | Uses removed `@stellar/freighter-api` API surface (`getPublicKey`, old `getNetwork` shape). Wallet connect is broken against the pinned dep. |
| `frontend/eslint.config.js` | The big `files: [...]` override lists **files that don't exist** (`RawDataViewer.tsx`, `ReadContract.tsx`, `WriteContract.tsx`, `SandboxPage.tsx`). |
| `indexer/src/migrate.js` | Ignores `.js` migrations; migration numbering has four `028_*` files and a broken `031` dependency. |
| `docker-compose.yml` | `indexer` service sets `DATABASE_URL=postgres://postgres:postgres@postgres:5432/...` but the `postgres` service only creates user `soroban`. The indexer container cannot reach its DB. Also uses `postgres:15-alpine` while CI/migrations target 16. |
| `docker-compose.override.yml` | Compose auto-merges this. It forces the **production** Dockerfiles and removes source mounts — the exact opposite of the "dev / hot-reload" behaviour the `Makefile` comments promise for `make docker-up`. |
| `deploy.yml` `release` | `body_path: CHANGELOG.md` / `files: CHANGELOG.md` — file absent. |
| `contracts/ticket` | `cargo test` runs only 4 tests from `src/lib.rs`; `tag-and-release.yml` claims "47/47 pass". Stale claim. |

---

## 6. Per-subsystem KEEP / CUT / FIX recommendation

Legend: **KEEP** = core to the pitch, keep and harden · **CUT** = remove for the resubmission (can live on a branch) · **FIX** = keep but must be repaired

### contracts/
- **KEEP + FIX** `contracts/explorer` — this is the strongest code in the repo (`#![no_std]`, structured errors, input-size limits, documented storage rationale, ring buffer). FIX: repair `tests/proptest.rs`; verify every test target compiles; re-run coverage gate.
- **DECIDE** `contracts/ticket` — it's a *sample* contract used for decoder testing. Reasonable to KEEP as a fixture, but then its "85% coverage" CI gate and fuzz targets should actually be wired and honest. If it's not pulling weight, CUT it and its 4 fuzz targets + 200 snapshot files.
- **CUT** the ~385 `test_snapshots/**/*.json` unless the snapshot tests are actually part of `cargo test` (they appear not to be run in CI).

### indexer/ — the big decision
The **spine to KEEP** (maps directly to MANIFEST): `index.js`, `decoder.js` + `scval.js` + `heuristicParser.js` + `sep41Metadata.js`, `db.js`, `api.js` (REST only), `config.js`, `logger.js`, `migrate.js`, `horizonClient.js`/`horizonBalances.js`, `contractRegistry`/ABI seeding, `health.js`, `metrics.js`, basic `rpcRetry.js`.

**Strong CUT candidates** (out of scope for "decode Soroban events to English", each adds deps, config, tests, and attack surface):
`kafkaEventBus` · `zkHostFunctions` · `rwaDecoder` · `vaultIndexer` · `stripe*` + `stripe` dep · `geoIpLimiter` + `maxmind` dep · `emailService`/`nodemailer`/`resend` · `circuitBreakerDetector`/`circuitBreakerIndexer` · `predictiveGapDetector` · `footprintContentionScanner` · `archivalEvictionDetector` · `bloatDetector` · `gasGuzzlers` · `storageTierClassifier` · `upgradeDetector` · `roleTracker` · `authTreeParser` · `deadLetterQueue` (unless the pipeline genuinely needs it) · `leaderElection` · `prefetchEngine`/`cacheWarming` · `graphql.js` (REST is the pitch) · `webhookDelivery` + webhook tables · `admin-cli.js` · `redis` (make cache purely in-process).

Cutting the above removes ~40 modules, ~40 test files, `stripe`/`maxmind`/`redis`/`nodemailer`/`resend`/`node-cron`/`graphql` from `dependencies`, and ~20 env vars from `config.js`/`.env.example`.

**FIX (whatever remains):**
- Remove `@stryker-mutator/command-runner`; regenerate `package-lock.json`; make `npm ci` pass.
- One test runner (recommend `node --test` since most tests already use it), one `npm test` that runs **all** `test/**/*.test.js` — no hand-picked list.
- Make tests **hermetic**: no test may hit `soroban-testnet.stellar.org` or `horizon-testnet.stellar.org`. Mock RPC/Horizon. Provide a `TEST_DATABASE_URL` via a Postgres service (already in CI) or `testcontainers`.
- Real coverage across the kept surface with an honest threshold (start where it lands, ratchet up).
- Fix the 3 `db.js` duplicate keys and the 2 syntax-broken test files.
- Fix migration chain: fold the `.js` migrations into `.sql` or teach `migrate.js` to run them; renumber the four `028`s; make `031` self-consistent on a blank DB. Add a CI job that runs migrations **and** rolls back.

### api/
- **CUT entirely.** It is orphaned dead code (no importer, no `package.json`, no entry point) duplicating `indexer/src/api.js`. If any middleware there is better than the indexer's (e.g. `validate.js`, `pagination.js`), port the specific file into `indexer/src/` and delete the rest.

### frontend/
- **KEEP + FIX** the pages that match the pitch: `Home` (feed + function filter), `ContractPage`, `WalletPage`, `EventPage`, `RegisterContractPage`, `SearchPage`, `Nav`, `EventTable`, `ErrorBoundary`, wallet connect.
- **CUT**: `Sandbox`/`SharedSandbox`/`DeveloperWorkspace` + `@webcontainer/api` + `monaco-editor` + `vite-plugin-monaco-editor` · `ContractDependencyGraph3D` + `3d-force-graph` · `DependencyVisualizer`/`AddressConnectionGraph` + `cytoscape` + `react-flow-renderer` (deprecated) · `SubInvocationFlamegraph`/`SubInvocationGraph`/`BatchMultiCall`/`XdrInspector`/`RpcMetricsDashboard`/`RateLimitDashboard`/`AuditLogPage`/`NftGallery`/`AbiDiffPage`/`GraphPage` unless one is genuinely central. Each drags heavy deps and test surface.
- **FIX**: import `WalletConnectButton` in `Nav.tsx`; update `useFreighter.ts` to the installed `@stellar/freighter-api` API; fix `WalletPage.test.tsx`; rebuild `eslint.config.js` (drop phantom files, add `eslint-plugin-react-hooks`, consider `tseslint.configs.recommendedTypeChecked`); align `@stellar/stellar-sdk` to the chosen major; make `no-explicit-any` an error, not a global "off".

### packages/
- **KEEP** `client` (it's the "lightweight JS client" the docs advertise) — FIX: pin deps, ensure `npm test` + `eslint` run in CI.
- **DECIDE** `sdk` (TS, codegen from OpenAPI) and `cli` — KEEP only if you'll actually publish them; otherwise CUT. `sdk` pins `vitest ^1` (two majors stale) and is only exercised on `release`.

### e2e/
- **KEEP** a *small* Playwright smoke suite (home loads, an event renders, contract page renders) + the API integration test, wired into CI as a real (non-nightly) gate.
- **CUT / move to a branch**: k6 baseline/spike/soak, Percy visual, chaos/fault-injection, synthetic monitoring, Stryker mutation. These are "above standard" but they are also unmaintained scaffolding that a reviewer reads as noise. `ci.yml`'s `visual-regression` and `k6-pr-baseline` jobs should go.

### CI/CD (`.github/workflows/`)
Collapse **10 workflows → 3**:
1. **`ci.yml`** — one workflow, parallel jobs: `contracts` (fmt, clippy `--all-targets`, wasm build, `cargo test` + coverage), `indexer` (install, lint, prettier, `npm test` with PG service + coverage, migrations + rollback), `frontend` (install, lint, `tsc`, `vite build`, `vitest`), `packages` (client + any kept package: lint + test), `e2e-smoke` (Playwright smoke + API integration), `secret-scan` (gitleaks), `openapi` (validate + Postman drift). Every job blocking. Add `permissions: contents: read` at top.
2. **`codeql.yml`** — keep; it's fine.
3. **`release.yml`** — replace `deploy.yml` + `tag-and-release.yml` + `publish-sdk.yml` + `docker-*.yml`. On tag: build + push the two Docker images (with real Trivy scan), build wasm artifact, create a GitHub Release from a **real `CHANGELOG.md`**. Cut the fake canary/blue-green/rollback theatre — or implement it for real against an actual target. Bump the deprecated `slackapi/slack-github-action@v1` steps to `@v2.1.0` (matching `ci.yml`) and update their `with:` blocks to the v2 input schema.

### docker / Makefile
- One `docker-compose.yml` that actually comes up: Postgres 16, **a `migrate` one-shot**, indexer, frontend, with **consistent credentials** sourced from `.env` (no hard-coded `soroban_secret`), correct Dockerfile per profile, healthchecks that hit endpoints that exist. Delete `docker-compose.override.yml` or make it a genuine dev overlay (source mounts + `Dockerfile.dev`).
- `make dev` / `docker compose up` must be the **one command** that yields a working stack (README already promises this).
- Drop Prometheus/Grafana/`stellar-quickstart` from the default compose (move to a `--profile observability` / `--profile chain`).

### docs/
- **KEEP + trim**: `README.md`, `MANIFEST.md`, `ROADMAP.md`, `BUDGET.md`, `TEAM.md`, `stellar.toml`, `architecture.md`, the ADRs, `CONTRIBUTING.md`, `getting-started`, `register-abi`, `adding-a-decoder`.
- **FIX**: every doc that references cut features or stale counts; the `README` badge for a `security.yml` workflow that doesn't exist (`codeql.yml` is the real one); the "Validated Need" section's future-dated claims ("as of May 2026").
- **CUT**: `docs/site/**` static site + `docs.yml` Pages workflow unless someone owns it.

---

## 7. Prioritised plan

### Phase 0 — Decisions (you)
- [ ] Approve the KEEP/CUT list in §6 (or amend it).
- [ ] Choose one `@stellar/stellar-sdk` major (recommend latest that both indexer and frontend can share).
- [ ] Decide the fate of the 1-commit history: at minimum, add an honest `README`/`CHANGELOG` note; ideally rebuild the repo with real incremental commits from this point forward.
- [ ] Confirm target Node version (recommend 22 LTS; CI currently says 20).

### Phase 1 — Make CI green on the current surface (no feature removal yet)
1. Remove `@stryker-mutator/command-runner`; `npm install` in `indexer/`; commit lockfile. `npm ci` passes.
2. Fix `contracts/explorer/tests/proptest.rs` (borrow `cid`, handle `Result`). `cargo clippy --all-targets` + `cargo test` + `cargo llvm-cov` pass.
3. Fix `frontend/src/components/Nav.tsx` import + `frontend/src/hooks/useFreighter.ts` API. `tsc` passes.
4. Fix `frontend/test/WalletPage.test.tsx`.
5. Fix `indexer/src/db.js` duplicate keys; fix `indexer/test/csrf.test.js` + `indexer/test/security/sql-injection.test.js` syntax errors.
6. Fix migrations on a blank DB (`.js` handling, `028` renumber, `031` dependency).
7. Add `CHANGELOG.md`; fix `deploy.yml`/`release` action versions or replace the workflow.
8. **Gate:** all `ci.yml` jobs green on a PR.

### Phase 2 — Trim to the MVP
9. Move cut subsystems to a `feature/extended` branch, then delete from `main`: `api/`, the indexer modules in §6, the frontend pages/deps in §6, `e2e` heavy suites, `docs/site`.
10. Prune `dependencies` / `devDependencies` / `.env.example` / `config.js` accordingly. Re-lock.
11. Collapse 10 workflows → 3 (§6).
12. **Gate:** `git ls-files | wc -l` roughly halved; CI still green; `.env.example` only contains variables the code reads.

### Phase 3 — Harden the MVP to "above standard"
13. **Lint in CI**: fix `indexer/eslint.config.js` globals (add `languageOptions.globals` for `node`/test runner via `globals` pkg), rebuild `frontend/eslint.config.js`; add `eslint` + `prettier --check` as blocking CI jobs for indexer, frontend, packages. Target **0 errors**.
14. **Hermetic tests**: mock all outbound RPC/Horizon; Postgres via CI service or testcontainers; one `npm test` that runs everything; coverage reported on the whole kept surface with a threshold that starts where it lands and ratchets.
15. **Structured logging + error handling**: confirm `logger.js` (pino-style JSON) is used everywhere — no stray `console.*`; every route through a single error middleware with request IDs; every background worker has a crash/restart policy.
16. **Security**: bump `@stellar/stellar-sdk`; `npm audit` clean (or documented, time-boxed exceptions); add `SECURITY.md`; extend CodeQL or add `cargo audit`/`cargo deny` (a `deny.toml` already exists — wire it into CI); re-verify the write-route auth guard.
17. **Docker/one-command**: single compose that boots Postgres + migrate + indexer + frontend from `.env`; `docker compose up` → working explorer at `localhost:5173`. Document in README.
18. **Docs**: reconcile README/MANIFEST/ROADMAP with the trimmed reality; fix badges; remove future-dated claims.
19. **Perf pass** (targeted, not speculative): confirm the hot query paths in `db.js` (`getEvents`, wallet history, contract detail) have covering indexes (`migrations/014_performance_indexes.sql`, `020_keyset_index.sql` exist — verify they match the actual queries); confirm keyset (not OFFSET) pagination end-to-end; confirm the frontend feed uses TanStack Query caching + the existing `useVirtualList`.
20. **Gate:** CI green; lint 0; coverage ≥ threshold; `npm audit` clean; `docker compose up` works from a clean checkout; README steps reproduce.

### Phase 4 — Resubmission polish
21. Real `CHANGELOG.md`; annotated release tag; verify the deployed testnet contract ID in README/`stellar.toml` is live.
22. Short screen capture / GIF of the explorer decoding a real event (the pitch in one image).
23. Re-read `docs/MANIFEST.md` and make sure every bullet is demonstrably true in the trimmed repo.

---

## 8. TODO (open questions for you)

- [ ] **Which cuts do you veto?** Some "extended" modules may be milestones you want to keep visible for SCF (e.g. GraphQL, webhooks). If so, they must be *finished and tested*, not scaffolding.
- [ ] Do you have write access to rewrite history / re-push, or is the 1-commit state fixed by the platform you submit to?
- [ ] Is there a real deployment target (a host, a k8s cluster, Fly.io, Railway…)? If yes, `deploy.yml` can become real. If no, cut it and say "runs via Docker Compose" honestly.
- [ ] Do `packages/sdk` and `packages/cli` need to ship (npm publish), or are they demo artifacts?
- [ ] Node 20 vs 22 vs 24 — pick one and set it everywhere (`.nvmrc`, `engines`, CI, Dockerfiles, devcontainer).
- [ ] Confirm the `ticket` contract's role — fixture (keep small) or feature (finish it).

---

## 9. Commands

### Local toolchain (this audit's environment — Alpine)
```bash
# Node 22 LTS (adjust to your OS package manager)
# Rust + wasm target
rustup target add wasm32-unknown-unknown && rustup component add clippy rustfmt
# PostgreSQL 16 (with contrib for pg_trgm)
```

### Reproduce the CI baseline locally
```bash
# Contracts
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings      # ❌ fails today (proptest.rs)
cargo build --target wasm32-unknown-unknown --release -p soroban-explorer-contract  # ✅
cargo test -p soroban-explorer-contract                        # ❌ fails to compile today
(cd contracts/ticket && cargo test --features testutils --release)  # ✅ 4 tests

# Indexer
cd indexer && npm ci                                           # ❌ fails today (bad dep + lock drift)
npm test                                                       # hand-picked list; hangs without DB
npm run test:coverage                                          # ❌ exits 1; covers 1 file
node src/migrate.js                                            # ❌ fails at 031 on blank DB
npx eslint .                                                   # ❌ 1398 errors
npx prettier --check .                                         # ❌ many files

# Frontend
cd frontend && npm ci                                          # ✅
npm run build                                                  # ❌ tsc exits 2
npx vitest run                                                 # ❌ 1/183 fails
npx eslint .                                                   # config largely disabled

# Database for indexer tests
export TEST_DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/soroban_explorer
```

### Run the app locally (intended — does not fully work today, see §5)
```bash
cp .env.example .env
cp indexer/.env.example indexer/.env
cp frontend/.env.example frontend/.env
make build && make deploy        # contract → prints CONTRACT_ID → put in .env
make install && make dev         # indexer :3001 + frontend :5173
# or:
docker compose up                # ❌ credential mismatch today
```

### Deploy
There is **no working deployment path today.** `deploy.yml` is placeholder `echo` steps. Options: (a) implement `release.yml` to build+push the two Docker images to GHCR and deploy to a real host you control; (b) document "self-host via `docker compose up`" and remove the deploy theatre.
