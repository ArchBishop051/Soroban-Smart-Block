-- Closes #902 — event filter DSL and saved queries.

-- Parse raw_data as JSONB without failing on malformed rows (→ NULL, i.e. the
-- filter predicate is false instead of the query erroring).
CREATE OR REPLACE FUNCTION explorer_try_jsonb(input TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN input::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- Numeric view of a JSON scalar (i128 amounts arrive as numbers or strings);
-- NULL when it is not a number.
CREATE OR REPLACE FUNCTION explorer_numeric(input TEXT) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN input ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' THEN input::numeric END
$$;

-- Saved queries, owned by an API key, usable for REST, WS and webhooks.
CREATE TABLE IF NOT EXISTS saved_queries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  UUID        NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  filter      JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_saved_queries_key ON saved_queries (api_key_id);

-- Webhook subscriptions can be driven by a filter (inline or from a saved query).
ALTER TABLE webhook_subscriptions ADD COLUMN IF NOT EXISTS filter JSONB;
