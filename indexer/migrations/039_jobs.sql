CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority_class TEXT NOT NULL CHECK (priority_class IN ('live','interactive','maintenance','bulk')),
  tenant_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  idempotency_key TEXT UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  progress NUMERIC NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ,
  worker_id TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, priority_class, available_at, created_at);
CREATE INDEX IF NOT EXISTS jobs_tenant_fairness_idx ON jobs(tenant_id, status, created_at);
