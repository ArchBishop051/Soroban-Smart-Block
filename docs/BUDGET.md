# Budget — Soroban Smart Block Explorer

> SCF Build Award budget request  
> Hourly rate: **$100 USD/hr** (blended rate, 2 engineers)  
> All costs cover development of Stellar-integrated components only.

---

## Tranche 1 — MVP (4 weeks)

| Task                                       | Engineer              | Hours       | Cost (USD)  |
| ------------------------------------------ | --------------------- | ----------- | ----------- |
| Soroban contract: registry + event store   | Rust/Soroban engineer | 40          | $4,000      |
| Contract unit tests + CI                   | Rust/Soroban engineer | 10          | $1,000      |
| Indexer: Soroban RPC polling + XDR decode  | Full-stack engineer   | 30          | $3,000      |
| PostgreSQL schema + REST API (5 endpoints) | Full-stack engineer   | 20          | $2,000      |
| React frontend: Home + Event detail pages  | Full-stack engineer   | 20          | $2,000      |
| DevOps: Makefile, .env, testnet deploy     | Full-stack engineer   | 8           | $800        |
| **Tranche 1 Total**                        |                       | **128 hrs** | **$12,800** |

---

## Tranche 2 — Testnet (6 weeks)

| Task                                       | Engineer              | Hours       | Cost (USD)  |
| ------------------------------------------ | --------------------- | ----------- | ----------- |
| ABI registry UI (submit + browse metadata) | Full-stack engineer   | 24          | $2,400      |
| Wallet history page + address search       | Full-stack engineer   | 16          | $1,600      |
| Contract detail page                       | Full-stack engineer   | 16          | $1,600      |
| Classic asset support via Horizon API      | Full-stack engineer   | 20          | $2,000      |
| Decoder: swap/stake/lend function types    | Rust/Soroban engineer | 20          | $2,000      |
| StellarSwap + Blend ABI integration        | Rust/Soroban engineer | 16          | $1,600      |
| Indexer performance tuning (< 10 s lag)    | Full-stack engineer   | 12          | $1,200      |
| End-to-end testing + bug fixes             | Both engineers        | 16          | $1,600      |
| **Tranche 2 Total**                        |                       | **140 hrs** | **$14,000** |

---

## Tranche 3 — Mainnet Launch (4 weeks)

| Task                                             | Engineer              | Hours       | Cost (USD)  |
| ------------------------------------------------ | --------------------- | ----------- | ----------- |
| Mainnet contract deployment + verification       | Rust/Soroban engineer | 12          | $1,200      |
| Production infrastructure (hosting, DB, backups) | Full-stack engineer   | 20          | $2,000      |
| Developer documentation (`docs/`)                | Both engineers        | 24          | $2,400      |
| Partner outreach + ABI onboarding (≥5 contracts) | Full-stack engineer   | 20          | $2,000      |
| Security review + audit-readiness prep           | Rust/Soroban engineer | 16          | $1,600      |
| Public launch + community demo                   | Both engineers        | 8           | $800        |
| **Tranche 3 Total**                              |                       | **100 hrs** | **$10,000** |

---

## Summary

| Tranche             | Duration     | Hours   | Cost (USD)  |
| ------------------- | ------------ | ------- | ----------- |
| Tranche 1 — MVP     | 4 weeks      | 128     | $12,800     |
| Tranche 2 — Testnet | 6 weeks      | 140     | $14,000     |
| Tranche 3 — Mainnet | 4 weeks      | 100     | $10,000     |
| **Total**           | **14 weeks** | **368** | **$36,800** |

> Budget requested: **$36,800 USD in XLM**  
> This is well within the $150,000 SCF Build Award cap and sized to the actual scope.  
> No marketing, token giveaways, or non-development expenses are included.

---

## Contract resource budget (CI gate)

Soroban fees scale with CPU instructions, memory, ledger I/O and event size,
so a PR that makes an entrypoint more expensive is a user-facing change. The
**Contracts (resource budget)** CI job fails such PRs before they merge.

### What is measured

| Source | Metrics |
| --- | --- |
| `contracts/explorer/tests/budget.rs` | every public explorer entrypoint: `cpu_insns`, `mem_bytes`, `event_bytes` |
| `contracts/ticket/src/test.rs` (`budget` module) | every public ticket entrypoint: same metrics |
| explorer release WASM | `wasm_bytes` |

Each entrypoint is invoked once with representative inputs on a fresh,
unlimited test-host budget. Numbers are deterministic (fixed PRNG seed, the
budget model does not depend on time or build profile), so two runs on the
same commit produce identical results.

`budget_covers_every_public_entrypoint` enumerates the `pub fn`s of the
`#[contractimpl]` block in `contracts/explorer/src/lib.rs` (the contract spec)
and fails if any entrypoint is not measured, so new entrypoints cannot skip
the gate.

soroban-sdk 21 only exposes CPU and memory from the test budget. Ledger
read/write entries and bytes will be added once the contracts move to an SDK
with `env.cost_estimate()`.

### Workflow

```bash
make budget          # build, measure, compare with the baseline
make budget-update   # build, measure, rewrite contracts/budget-baseline.json
```

`scripts/budget-check.js` compares `target/budget/*.json` and the WASM size
with `contracts/budget-baseline.json` and writes `target/budget/report.md`.

| Situation | Result |
| --- | --- |
| Metric grows more than its threshold | ❌ job fails, table lists the regressions |
| Metric grows within threshold | ✅ pass |
| Metric decreases | ✅ pass, report suggests `make budget-update` |
| Entrypoint has no baseline entry | ⚠️ warning; add it with `make budget-update` in the same PR |

Thresholds live in the baseline file (`thresholds`), per metric. Defaults are
+5%, with `wasm_bytes` at +10% to absorb toolchain drift between the stable
compiler used locally and in CI.

In CI the report is posted as a PR comment and added to the job summary.

### Changing the baseline

If a cost increase is intended:

1. Run `make budget-update` and commit `contracts/budget-baseline.json`.
2. Explain the increase in the PR description.
3. A maintainer adds the `budget-change-approved` label and re-runs the job.
   The job fails whenever the baseline file changes without that label.
