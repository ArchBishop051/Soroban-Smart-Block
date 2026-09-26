-- Migration 037: Keyset pagination composite indexes
--
-- Closes #855 — Keyset (cursor) pagination replacing OFFSET across all list endpoints.
--
-- Adds composite indexes matching the stable ordering tuples across list endpoints:
-- 1. events: (seq DESC), (contract_id, seq DESC), (ledger DESC, seq DESC)
-- 2. contracts: (created_at DESC, id DESC), (protocol_type, created_at DESC, id DESC)
-- 3. sandboxes: (updated_at DESC, sandbox_id DESC)
-- 4. api_audit_log: (timestamp DESC, id DESC)
--
-- Idempotent (IF NOT EXISTS) so migration is safe to re-run.

CREATE INDEX IF NOT EXISTS idx_events_seq_desc ON events (seq DESC);
CREATE INDEX IF NOT EXISTS idx_events_contract_seq ON events (contract_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_events_ledger_seq ON events (ledger DESC, seq DESC);

CREATE INDEX IF NOT EXISTS idx_contracts_created_at_id ON contracts (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_type_created_at_id ON contracts (protocol_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sandboxes_updated_at_id ON sandboxes (updated_at DESC, sandbox_id DESC);

CREATE INDEX IF NOT EXISTS idx_api_audit_log_timestamp_id ON api_audit_log (timestamp DESC, id DESC);
