CREATE SCHEMA IF NOT EXISTS analytics;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_reader') THEN
    CREATE ROLE analytics_reader NOLOGIN;
  END IF;
END
$$;

CREATE OR REPLACE VIEW analytics.events WITH (security_barrier = true) AS
  SELECT network, seq, contract_id, function, ledger, tx_hash, description,
         cpu_instructions, mem_bytes, fee_charged, created_at
  FROM public.events;

CREATE OR REPLACE VIEW analytics.transactions WITH (security_barrier = true) AS
  SELECT network, tx_hash, MIN(ledger) AS ledger, MIN(created_at) AS created_at,
         COUNT(*) AS event_count, SUM(fee_charged) AS fee_charged
  FROM public.events
  WHERE tx_hash IS NOT NULL
  GROUP BY network, tx_hash;

CREATE OR REPLACE VIEW analytics.rollups WITH (security_barrier = true) AS
  SELECT network, ledger, COUNT(*) AS event_count,
         COUNT(DISTINCT tx_hash) AS transaction_count,
         SUM(fee_charged) AS fee_charged
  FROM public.events
  GROUP BY network, ledger;

CREATE OR REPLACE VIEW analytics.tokens WITH (security_barrier = true) AS
  SELECT contract_id, address, balance_raw, token_id, metadata_json, last_transfer_ledger, updated_at
  FROM public.token_holders;

REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA analytics TO analytics_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO analytics_reader;
