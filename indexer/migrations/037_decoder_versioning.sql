-- Closes #899 — decoder output versioning.
-- decoder_version: "decoder_id@semver" of the decoder that produced the row.
-- decoder_retired: the decoder no longer exists; the row is kept as is.
ALTER TABLE events ADD COLUMN IF NOT EXISTS decoder_version TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS decoder_retired BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_events_decoder_version ON events (decoder_version) WHERE decoder_retired = FALSE;

-- Previous outputs replaced by a re-decode, for audit and rollback review.
CREATE TABLE IF NOT EXISTS decoded_history (
  id               BIGSERIAL   PRIMARY KEY,
  event_seq        BIGINT      NOT NULL,
  decoder_version  TEXT,
  function         TEXT,
  description      TEXT,
  raw_topics       JSONB,
  raw_data         TEXT,
  replaced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_decoded_history_event ON decoded_history (event_seq);
