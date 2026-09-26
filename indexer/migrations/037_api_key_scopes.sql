-- Closes #901 — scoped API tokens.
-- scopes: permission set (read:events, read:contracts, write:contracts,
--   write:webhooks, read:usage, write:keys, admin:*).
-- allowed_contract_ids / allowed_origins: optional restrictions (NULL = none).
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes TEXT[];
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_contract_ids TEXT[];
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_origins TEXT[];

-- Existing keys keep their current (non-admin) access: no breaking change.
UPDATE api_keys
   SET scopes = ARRAY['read:events', 'read:contracts', 'write:contracts', 'write:webhooks', 'read:usage', 'write:keys']
 WHERE scopes IS NULL;

-- New keys are read-only unless created with explicit scopes.
ALTER TABLE api_keys ALTER COLUMN scopes SET DEFAULT ARRAY['read:events', 'read:contracts'];
ALTER TABLE api_keys ALTER COLUMN scopes SET NOT NULL;
