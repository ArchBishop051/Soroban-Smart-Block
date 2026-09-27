# Durable fan-out, rollups, and balance reconciliation

Indexed events are queued in `indexer_outbox` after the event write commits.
`outboxRelay` claims rows with `FOR UPDATE SKIP LOCKED`, publishes the stable
`event_id` to WebSocket/SSE/webhook consumers, and marks rows dispatched only
after delivery. A relay crash therefore causes a retry rather than a phantom
event; consumers should deduplicate by `event_id`.

Hourly contract/function rollups are updated incrementally and can be
decremented during reorg handling. Caller samples are stored as JSON arrays;
large deployments may replace this with PostgreSQL HyperLogLog while retaining
the same error-bounded confidence semantics.

`balanceReconciler` compares a derived holder balance with an on-chain value at
the same ledger. It records every mismatch in `balance_drift` and reports
`unknown` when an archived entry cannot be queried; history is never mutated.
