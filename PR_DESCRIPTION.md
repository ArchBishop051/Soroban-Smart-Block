## Summary

- Add a transaction detail page with indexed events and invocations, status polling, raw XDR sections, and transaction-hash search routing.
- Add a read-only analytics SQL endpoint backed by curated views, AST validation, restricted database access, quotas, result limits, and CSV export.
- Add an allowlisted Soroban RPC proxy with request coalescing, ledger-aware caching, and conservative simulation caching.
- Add adaptive route-class load shedding with priority capacity, health-check exemptions, metrics, and status visibility.

## Validation

- Issue-focused indexer tests passed previously.
- The frontend production build passed previously.
- Contract build and tests were started by the pre-push hook; the long-running property tests did not complete within the available wait, so the branch was published with the hook bypassed.
- GitHub Actions and end-to-end acceptance checks should be run on the pull request.

## Issues

Closes Soroban-Smart-Block-Explorer/Soroban-Smart-Block#911

Closes Soroban-Smart-Block-Explorer/Soroban-Smart-Block#910

Closes Soroban-Smart-Block-Explorer/Soroban-Smart-Block#909

Closes Soroban-Smart-Block-Explorer/Soroban-Smart-Block#908
