# Game Day Runbook — Staging Chaos Suite

The chaos suite (`deploy/chaos/`) injects real failures into the
`soroban-explorer-staging` namespace and checks that the system holds its
steady state. It runs weekly via `.github/workflows/chaos.yml` (Tuesday
03:00 UTC) and can be run by hand for a game day.

## Experiments

| Name | Fault | Hypothesis |
|---|---|---|
| `kill-ingest-leader` | Kill the ingest leader pod | New leader elected; lag < 30 ledgers within 2 min; no new gaps |
| `kill-api-pods` | Kill 50% of API pods under k6 load | 5xx ≤ 1% of error budget |
| `postgres-primary-failover` | Kill the Postgres primary | Lag recovers within 3 min; no data loss |
| `rpc-partition` | Partition ingest from all RPC providers for 2 min | Lag recovers within 5 min; gap detection backfills |
| `postgres-latency` | +500 ms to Postgres for 5 min under load | 5xx ≤ 2% of error budget |
| `redis-loss` | Redis unavailable for 3 min | API degrades gracefully; no ingest impact |
| `clock-skew` | Ingest node clock −5 min | No duplicate or reordered events |
| `worker-disk-full` | ENOSPC on worker `/tmp` for 3 min | Worker recovers; failed items land in the DLQ |

Thresholds live in `deploy/chaos/hypotheses.json`. "No data loss" is checked by
comparing unresolved gaps from `/api/gaps` before and after each experiment.

## Running

```bash
export KUBECONFIG=...           # staging cluster
export API_URL=https://staging.example.com
export PROM_URL=http://prometheus.monitoring:9090
deploy/chaos/run.sh             # all experiments
deploy/chaos/run.sh rpc-partition
```

Or dispatch the **Chaos — staging** workflow with an optional experiment name.

## Safety

- **Blast radius:** every manifest is namespaced to `soroban-explorer-staging`
  and has a bounded `duration` or is a one-shot pod kill.
- **Abort switch:** `deploy/chaos/run.sh abort` deletes all experiments and the
  lock. The script also aborts on exit/Ctrl-C, and cancelling the workflow runs
  the abort step.
- **Scheduling lock:** chaos and staging deploys share the `staging-deploy-lock`
  concurrency group, and `run.sh` skips the run if an Argo rollout is
  progressing or paused.

## Game day checklist

1. Announce the window in `#ops`; confirm nobody is deploying to staging.
2. Open the Grafana indexer dashboard and the Argo Rollouts dashboard.
3. Run the suite; narrate each experiment and watch alerts fire and clear.
4. For every `FAIL` row, file a bug with the report excerpt and the Grafana
   snapshot, label `chaos`, and link it in the report.
5. Reports are uploaded as the `chaos-report-<run_id>` CI artifact
   (retained 400 days).
