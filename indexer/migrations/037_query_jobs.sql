-- Closes #906 — asynchronous query jobs for heavy analytical requests.
CREATE TABLE IF NOT EXISTS query_jobs (
  id               UUID PRIMARY KEY,
  api_key_id       TEXT NOT NULL,
  tier             TEXT NOT NULL,
  type             TEXT NOT NULL,
  params           JSONB NOT NULL DEFAULT '{}',
  format           TEXT NOT NULL,                  -- 'ndjson' | 'csv'
  status           TEXT NOT NULL DEFAULT 'queued', -- queued | running | succeeded | failed | cancelled | expired
  rows_written     BIGINT NOT NULL DEFAULT 0,
  bytes_written    BIGINT NOT NULL DEFAULT 0,
  partial          BOOLEAN NOT NULL DEFAULT FALSE, -- stopped early (quota) — result is incomplete
  snapshot_ledger  BIGINT,                         -- last indexed ledger when the snapshot was taken
  error            TEXT,
  result_path      TEXT,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_query_jobs_idempotency
  ON query_jobs (api_key_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_query_jobs_key_status ON query_jobs (api_key_id, status);
CREATE INDEX IF NOT EXISTS idx_query_jobs_expires ON query_jobs (expires_at) WHERE expires_at IS NOT NULL;
