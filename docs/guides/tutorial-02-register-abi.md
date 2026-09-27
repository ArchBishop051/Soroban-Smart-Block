# Tutorial 2 — Register an ABI and see decoded output

**Time:** ~10 minutes · **Source:** [`examples/tutorials/02-register-abi`](../../examples/tutorials/02-register-abi/index.mjs)

Without an ABI the explorer falls back to heuristics. Registering one gives every event from your contract named functions and arguments.

## 1. Register

`POST /api/contracts` requires an API key (`API_KEY`). Set `CONTRACT_ID` to your deployed contract.

<!-- snippet: examples/tutorials/02-register-abi/index.mjs#register -->

## 2. Read it back

<!-- snippet: examples/tutorials/02-register-abi/index.mjs#read -->

New events for the contract are now decoded against this ABI; existing events are re-decoded in the background when the ABI version changes.

## Run it

```bash
API_KEY=... CONTRACT_ID=C... node 02-register-abi/index.mjs
```

To register on-chain instead, see [register-abi.md](./register-abi.md).
