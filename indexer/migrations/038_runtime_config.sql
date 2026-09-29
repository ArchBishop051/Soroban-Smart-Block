-- Closes #894 — hot-reloadable runtime configuration.
-- Each change is a new version (optimistic concurrency on version); the
-- latest version is live on every instance via LISTEN/NOTIFY runtime_config.
CREATE TABLE IF NOT EXISTS runtime_config (
  version     INTEGER     PRIMARY KEY,
  config      JSONB       NOT NULL,
  author      TEXT,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
