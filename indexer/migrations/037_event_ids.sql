-- Closes #892 — canonical, stable event IDs (Soroban RPC format).
-- event_id is derived from chain position, so it survives re-indexing and
-- restores. Unique per network (the network is part of the lookup key).
-- Rows indexed before this migration get their IDs when their ledger range
-- is re-indexed; until then they are still reachable by numeric seq.
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_network_event_id ON events (network, event_id) WHERE event_id IS NOT NULL;
