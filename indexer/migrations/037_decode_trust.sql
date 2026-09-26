-- Persist whether a human-readable event description was shape-checked against its ABI.
ALTER TABLE events ADD COLUMN IF NOT EXISTS decode_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE events ADD COLUMN IF NOT EXISTS decode_warnings JSONB;

CREATE INDEX IF NOT EXISTS idx_events_decode_status ON events(decode_status);