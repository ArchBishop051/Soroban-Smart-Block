CREATE TABLE IF NOT EXISTS indexer_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  payload JSONB NOT NULL,
  locked_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS indexer_outbox_pending_idx ON indexer_outbox (id) WHERE dispatched_at IS NULL;
CREATE TABLE IF NOT EXISTS rollup_contract_hourly (contract_id TEXT NOT NULL, hour TIMESTAMPTZ NOT NULL, events BIGINT NOT NULL DEFAULT 0, fee_sum NUMERIC NOT NULL DEFAULT 0, callers JSONB NOT NULL DEFAULT '[]', PRIMARY KEY (contract_id, hour));
CREATE TABLE IF NOT EXISTS rollup_function_hourly (contract_id TEXT NOT NULL, function_name TEXT NOT NULL, hour TIMESTAMPTZ NOT NULL, events BIGINT NOT NULL DEFAULT 0, fee_sum NUMERIC NOT NULL DEFAULT 0, callers JSONB NOT NULL DEFAULT '[]', PRIMARY KEY (contract_id, function_name, hour));
CREATE TABLE IF NOT EXISTS balance_drift (id BIGSERIAL PRIMARY KEY, token_id TEXT NOT NULL, holder TEXT NOT NULL, observed_ledger BIGINT NOT NULL, derived NUMERIC, on_chain NUMERIC, magnitude NUMERIC, status TEXT NOT NULL DEFAULT 'detected', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS balance_drift_token_holder_idx ON balance_drift (token_id, holder, observed_ledger);
