# Tutorial 1 — Index your own contract's events

**Time:** ~10 minutes · **Source:** [`examples/tutorials/01-index-contract-events`](../../examples/tutorials/01-index-contract-events/index.mjs)

You will run the local stack, point the indexer at your network, and read your contract's decoded events back from the API.

## 1. Start the stack

```bash
docker compose up -d            # Postgres, stellar/quickstart, indexer, frontend
cd examples/tutorials && npm ci
```

The indexer polls `SOROBAN_RPC_URL` from `START_LEDGER` and stores every contract event it sees. Deploy and invoke your contract against the same network (see [register-contract.md](./register-contract.md)).

## 2. Check the indexer is healthy

<!-- snippet: examples/tutorials/01-index-contract-events/index.mjs#health -->

## 3. Fetch your contract's events

Set `CONTRACT_ID` to your contract's `C…` address (omit it to see all contracts):

<!-- snippet: examples/tutorials/01-index-contract-events/index.mjs#events -->

## 4. Paginate

`/api/events` uses keyset pagination: pass `next_cursor` back as `after_seq`.

<!-- snippet: examples/tutorials/01-index-contract-events/index.mjs#paginate -->

## Run it

```bash
CONTRACT_ID=C... node 01-index-contract-events/index.mjs
```
