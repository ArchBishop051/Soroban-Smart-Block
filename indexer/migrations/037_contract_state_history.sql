CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS contract_state_versions (
  id BIGSERIAL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  key_xdr TEXT NOT NULL,
  durability TEXT NOT NULL,
  ledger_from BIGINT NOT NULL,
  ledger_to BIGINT,
  value_xdr TEXT,
  decoded_key JSONB,
  decoded_value JSONB,
  tx_hash TEXT,
  tx_index INTEGER NOT NULL DEFAULT 0,
  change_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ledger_range int8range GENERATED ALWAYS AS (int8range(ledger_from, COALESCE(ledger_to + 1, NULL), '[)')) STORED
);
CREATE INDEX IF NOT EXISTS contract_state_versions_range_gist ON contract_state_versions USING GIST (contract_id, ledger_range);
CREATE INDEX IF NOT EXISTS contract_state_versions_key_ledger ON contract_state_versions (contract_id, key_xdr, ledger_from DESC);
