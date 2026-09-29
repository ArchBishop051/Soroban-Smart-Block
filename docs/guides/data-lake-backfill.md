# Data-lake backfill

The indexer can read historical LedgerCloseMeta files from Galexie/CDP object
storage while using Soroban RPC for the retention window at the tip. Set
`DATALAKE_URL`, enable `DATALAKE_ENABLED=true`, and optionally provide
`DATALAKE_SCHEMA='{"ledgersPerFile":1,"filesPerPartition":1000}'` plus object
storage credentials. Missing objects are surfaced as gap errors and are never
silently skipped. A deployment-specific streaming zstd decoder should be
passed to `DataLakeSource` so large files are not buffered in memory.

The source adapters expose the same ordered ledger/event shape. Overlapping
ranges are deduplicated by ledger and the existing event uniqueness constraint
keeps the cutover idempotent.
