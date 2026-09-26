-- Data lineage (#945): one row per ingest batch; events reference their batch.
CREATE TABLE IF NOT EXISTS lineage_batches (
  id               BIGSERIAL PRIMARY KEY,
  run_type         TEXT NOT NULL CHECK (run_type IN ('live', 'backfill', 'replay', 'redecode', 'reconcile')),
  run_id           TEXT NOT NULL,
  source           TEXT NOT NULL,
  ledger_from      BIGINT,
  ledger_to        BIGINT,
  code_version     TEXT NOT NULL,
  decoder_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rows written before lineage existed keep NULL and are reported as "legacy".
ALTER TABLE events ADD COLUMN IF NOT EXISTS lineage_batch_id BIGINT REFERENCES lineage_batches(id);

-- Append-only history of later writes (re-decodes, reconciliations) to a row.
CREATE TABLE IF NOT EXISTS lineage_events (
  id         BIGSERIAL PRIMARY KEY,
  event_seq  BIGINT NOT NULL,
  batch_id   BIGINT NOT NULL REFERENCES lineage_batches(id),
  action     TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lineage_events_event_seq ON lineage_events (event_seq, id);
