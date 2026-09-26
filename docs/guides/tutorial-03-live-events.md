# Tutorial 3 — Subscribe to live events

**Time:** ~5 minutes · **Source:** [`examples/tutorials/03-live-events`](../../examples/tutorials/03-live-events/index.mjs)

The indexer pushes `events_batch` messages over WebSocket as each ledger is indexed.

## Subscribe

<!-- snippet: examples/tutorials/03-live-events/index.mjs#subscribe -->

## Run it

```bash
LISTEN_SECONDS=30 node 03-live-events/index.mjs
```

Invoke your contract while it runs to see events arrive. For an interactive terminal view, try `soroban-explorer tui`. More detail: [websocket-streaming.md](./websocket-streaming.md).
