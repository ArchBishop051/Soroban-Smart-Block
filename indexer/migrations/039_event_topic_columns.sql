-- Closes #903 — Soroban-RPC-compatible topic filters.
-- topic0..topic3: sha256 of each topic's canonical XDR (ScVal symbol vs string
-- with the same text hash differently). topic_count: number of topics.
-- Rows indexed before this migration have NULLs and only match filters
-- without topic patterns until they are re-indexed.
ALTER TABLE events ADD COLUMN IF NOT EXISTS topic0 BYTEA;
ALTER TABLE events ADD COLUMN IF NOT EXISTS topic1 BYTEA;
ALTER TABLE events ADD COLUMN IF NOT EXISTS topic2 BYTEA;
ALTER TABLE events ADD COLUMN IF NOT EXISTS topic3 BYTEA;
ALTER TABLE events ADD COLUMN IF NOT EXISTS topic_count SMALLINT;

CREATE INDEX IF NOT EXISTS idx_events_contract_topic0 ON events (contract_id, topic0);
CREATE INDEX IF NOT EXISTS idx_events_topic0_hash ON events (topic0) WHERE topic0 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_topic1_hash ON events (topic1) WHERE topic1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_topic2_hash ON events (topic2) WHERE topic2 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_topic3_hash ON events (topic3) WHERE topic3 IS NOT NULL;
