-- Real-time collaborative sandbox sessions (#926).
-- `state` is the Yjs document encoded with Y.encodeStateAsUpdate; tokens are
-- stored as SHA-256 hashes only.
CREATE TABLE IF NOT EXISTS collab_sessions (
  id TEXT PRIMARY KEY,
  sandbox_id TEXT,
  state BYTEA,
  owner_token_hash TEXT NOT NULL,
  edit_token_hash TEXT NOT NULL,
  view_token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_sessions_updated_at ON collab_sessions (updated_at);
