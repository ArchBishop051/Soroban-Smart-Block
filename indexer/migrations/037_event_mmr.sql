CREATE TABLE IF NOT EXISTS event_mmr_nodes (
  level INTEGER NOT NULL,
  node_index BIGINT NOT NULL,
  hash TEXT NOT NULL,
  leaf_count BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (level, node_index)
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS integrity TEXT NOT NULL DEFAULT 'verified';
CREATE INDEX IF NOT EXISTS idx_events_integrity ON events(integrity);
