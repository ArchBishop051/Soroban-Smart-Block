# Disaster Recovery — Multi-Region

Covers the loss of an entire region. In-region point-in-time recovery is
covered separately (#860).

## Targets

| | Target | How it's met |
|---|---|---|
| **RPO** | < 1 min | Async cross-region Postgres replica; lag alarmed at 30 s |
| **RTO** | < 15 min | Warm standby stack, scripted failover, Route 53 failover records |

## Topology

- **Postgres:** RDS cross-region read replica (`infra/terraform/dr`).
- **Object storage:** S3 replication (15 min RTC) of exports/backups to `<bucket>-dr`.
- **Images:** mirrored to ECR in the secondary region.
- **Stack:** warm standby installed with
  `helm install explorer deploy/helm/soroban-explorer -f deploy/helm/soroban-explorer/values-standby.yaml`
  — 1 API and 1 frontend replica, **ingest disabled** until promotion.
- **DNS:** Route 53 PRIMARY/SECONDARY failover records with a health check on
  `/api/health`.

## Failover

```bash
deploy/dr/failover.sh failover
```

Steps, in order:

1. **Fence the old primary.** Writer pods scaled to 0, a `dr-fenced` marker is
   written, and the primary DB gets a read-only parameter group if the region
   is still reachable. Nothing accepts writes in the new region until this is done,
   which prevents split-brain.
2. **Promote** the replica in the secondary region.
3. **Scale up** the standby and **enable ingest**. Ingest resumes from its
   committed cursor.
4. **Switch DNS** to the secondary load balancer.
5. Wait for `/api/health`, then write RPO/RTO to `dr-report.md`.

### Edge cases

- **Failover mid-ingest:** ingest is idempotent (#846), so any ledgers it
  replays are upserted without creating duplicates.
- **Replication lag at failure:** data between the replica LSN and the old
  primary is lost from Postgres. It is re-ingested from chain on resume, and
  gap detection backfills anything the cursor skipped.

## Failback

1. Rebuild the primary region's DB as a replica of the promoted instance
   (`terraform apply` in `infra/terraform/dr` with the roles swapped).
2. Once it's caught up, run `deploy/dr/failover.sh failback`. This fences the
   secondary, enables ingest in the primary, and returns the secondary to standby.
3. Re-apply `infra/terraform/dr` to restore the DNS records and recreate the replica.

## Quarterly drill

`.github/workflows/dr-drill.yml` runs on the 15th of Jan/Apr/Jul/Oct (or on
dispatch). It fails over staging, measures RPO/RTO, fails back, and commits the
report to `docs/dr-reports/<date>.md`. The job fails if a target is missed.
