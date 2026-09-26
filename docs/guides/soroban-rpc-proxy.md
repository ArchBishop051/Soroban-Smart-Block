# Soroban RPC proxy

`POST /api/rpc` accepts JSON-RPC requests for `simulateTransaction`,
`getLedgerEntries`, `getLatestLedger`, `getNetwork`, and `getEvents`. Other
methods, including `sendTransaction`, are rejected. Requests are limited to
32 KB and pass through the indexer's existing per-key rate limits and
multi-node failover pool.

Identical in-flight calls are coalesced. Ledger-entry responses are cached by
the latest ledger sequence and hash, and read-only simulations are cached by
the same ledger identity and transaction XDR only when the returned footprint
has no write keys. Indexing a new ledger invalidates those cache entries.

The frontend's Soroban request helper tries this proxy for the configured
default RPC endpoint and falls back to that endpoint directly if the proxy is
unavailable. Custom network endpoints continue to use their configured RPC
URL directly.
