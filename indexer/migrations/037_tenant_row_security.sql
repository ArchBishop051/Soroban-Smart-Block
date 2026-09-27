ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_events_network_seq ON events (network, seq ASC);
CREATE INDEX IF NOT EXISTS idx_events_contract_seq_desc ON events (contract_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_created_at_id ON contracts (created_at DESC, id DESC);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contracts_tenant_access ON contracts;
CREATE POLICY contracts_tenant_access ON contracts
  FOR ALL
  USING (
    is_private = FALSE
    OR registered_by_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
  )
  WITH CHECK (
    is_private = FALSE
    OR registered_by_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
  );

ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contract_versions_tenant_access ON contract_versions;
CREATE POLICY contract_versions_tenant_access ON contract_versions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = contract_versions.contract_id
        AND (c.is_private = FALSE
          OR c.registered_by_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
          OR current_setting('app.rls_bypass', TRUE) = 'true')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = contract_versions.contract_id
        AND (c.is_private = FALSE
          OR c.registered_by_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
          OR current_setting('app.rls_bypass', TRUE) = 'true')
    )
  );

ALTER TABLE contract_abi_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_abi_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contract_abi_versions_tenant_access ON contract_abi_versions;
CREATE POLICY contract_abi_versions_tenant_access ON contract_abi_versions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = contract_abi_versions.contract_id
        AND (c.is_private = FALSE
          OR c.registered_by_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
          OR current_setting('app.rls_bypass', TRUE) = 'true')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = contract_abi_versions.contract_id
        AND (c.is_private = FALSE
          OR c.registered_by_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
          OR current_setting('app.rls_bypass', TRUE) = 'true')
    )
  );

ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_key_usage_tenant_access ON api_key_usage;
CREATE POLICY api_key_usage_tenant_access ON api_key_usage
  FOR ALL
  USING (
    api_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
  )
  WITH CHECK (
    api_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
  );

ALTER TABLE api_key_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_usage_daily FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_key_usage_daily_tenant_access ON api_key_usage_daily;
CREATE POLICY api_key_usage_daily_select ON api_key_usage_daily
  FOR SELECT
  USING (
    api_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
  );
CREATE POLICY api_key_usage_daily_insert ON api_key_usage_daily
  FOR INSERT
  WITH CHECK (
    api_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
    OR current_setting('app.api_key_id', TRUE) IS NULL
  );
CREATE POLICY api_key_usage_daily_update ON api_key_usage_daily
  FOR UPDATE
  USING (
    api_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
    OR current_setting('app.api_key_id', TRUE) IS NULL
  )
  WITH CHECK (
    api_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
    OR current_setting('app.api_key_id', TRUE) IS NULL
  );
CREATE POLICY api_key_usage_daily_delete ON api_key_usage_daily
  FOR DELETE
  USING (
    current_setting('app.rls_bypass', TRUE) = 'true'
    OR current_setting('app.api_key_id', TRUE) IS NULL
  );

ALTER TABLE api_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_audit_log FORCE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp_id ON api_audit_log (timestamp DESC, id DESC);
DROP POLICY IF EXISTS api_audit_log_tenant_access ON api_audit_log;
CREATE POLICY api_audit_log_tenant_access ON api_audit_log
  FOR ALL
  USING (
    api_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
  )
  WITH CHECK (
    api_key_id IS NULL
    OR api_key_id::TEXT = NULLIF(current_setting('app.api_key_id', TRUE), '')
    OR current_setting('app.rls_bypass', TRUE) = 'true'
    OR current_setting('app.api_key_id', TRUE) IS NULL
  );