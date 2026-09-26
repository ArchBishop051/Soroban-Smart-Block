-- Closes #895 — record how each event was decoded:
-- abi (registered ABI) | spec (on-chain contractspecv0 / built-in SAC spec)
-- | spec_mismatch (spec present, arguments did not match) | heuristic.
ALTER TABLE events ADD COLUMN IF NOT EXISTS decode_source TEXT;
