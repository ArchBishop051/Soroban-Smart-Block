ALTER TABLE events ADD COLUMN IF NOT EXISTS protocol_version INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS raw_xdr TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS protocol_degraded BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS events_protocol_version_idx ON events(protocol_version);
