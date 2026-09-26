# Tutorial 6 — Verify an event inclusion proof

> **In progress:** the explorer does not serve inclusion proofs yet, so this tutorial is excluded from CI. Until then it cross-checks an indexed event against the network's own RPC.

**Time:** ~10 minutes · **Source:** [`examples/tutorials/06-verify-inclusion-proof`](../../examples/tutorials/06-verify-inclusion-proof/index.mjs)

Don't trust the explorer blindly: confirm an event against an RPC node you choose.

## Talk to Soroban RPC

<!-- snippet: examples/tutorials/06-verify-inclusion-proof/index.mjs#rpc -->

## Verify

<!-- snippet: examples/tutorials/06-verify-inclusion-proof/index.mjs#verify -->

## Run it

```bash
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org EVENT_SEQ=42 node 06-verify-inclusion-proof/index.mjs
```
