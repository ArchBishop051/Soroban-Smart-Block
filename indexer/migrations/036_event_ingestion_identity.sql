-- Use the RPC event identity for retry-safe ingestion while allowing multiple
-- contract events from one transaction to coexist.
ALTER TABLE events ADD COLUMN IF NOT EXISTS ingestion_id TEXT;

DROP INDEX IF EXISTS idx_events_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ingestion_id
  ON events (ingestion_id)
  WHERE ingestion_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup_legacy
  ON events (contract_id, ledger, tx_hash)
  WHERE ingestion_id IS NULL;