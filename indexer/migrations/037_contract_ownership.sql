-- Closes #875 — on-chain proof of contract ownership.
-- Mirrors the explorer contract's `get_ownership` result, refreshed by the
-- contract verifier job. Distinct from source verification (#796) and from
-- ABI verification (is_verified, migration 012).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS ownership_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS ownership_owner TEXT;
-- 'TargetAdmin' | 'TargetOwner' | 'Deployer'
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS ownership_method TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS ownership_ledger INTEGER;
