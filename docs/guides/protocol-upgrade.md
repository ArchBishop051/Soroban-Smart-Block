# Protocol upgrade readiness

The indexer records the protocol version on every event and compares observed
ledger versions with `PROTOCOL_MAX_VERSION` (the bundled SDK support ceiling).
When a network announces a newer protocol, the indexer raises
`PROTOCOL_UNSUPPORTED`, enters degraded mode, and retains raw XDR instead of
dropping or crashing on an unknown union arm.

Set `PROTOCOL_MAX_VERSION` to the supported SDK version during a deployment.
After upgrading `@stellar/stellar-sdk`, the re-decode worker can process rows
marked `protocol_degraded` and clear the marker. Rows are never re-decoded
when their protocol is newer than the configured ceiling, which keeps rollback
deployments safe.

## Rollout checklist

1. Run the simulated pre/post-upgrade fixture suite in CI.
2. Deploy the SDK upgrade with `PROTOCOL_MAX_VERSION` set to the new version.
3. Confirm the `PROTOCOL_UNSUPPORTED` alert resolves and degraded rows drain.
4. Keep the raw-XDR retention policy enabled until the re-decode backlog is zero.

The nightly workflow includes a future quickstart smoke job so new XDR arms are
observed before a network upgrade reaches production.
