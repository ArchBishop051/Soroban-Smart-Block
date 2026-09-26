CREATE TABLE IF NOT EXISTS transactions (
  hash TEXT PRIMARY KEY,
  ledger BIGINT NOT NULL,
  source TEXT,
  status TEXT NOT NULL,
  result_code TEXT,
  operation_count INTEGER NOT NULL DEFAULT 0,
  footprint_read_bytes BIGINT,
  footprint_write_bytes BIGINT,
  fee_payer TEXT,
  inner_source TEXT,
  inclusion_fee NUMERIC NOT NULL DEFAULT 0,
  resource_fee NUMERIC NOT NULL DEFAULT 0,
  refundable_fee_charged NUMERIC NOT NULL DEFAULT 0,
  refund_amount NUMERIC NOT NULL DEFAULT 0,
  rent_fee NUMERIC NOT NULL DEFAULT 0,
  charged_fee NUMERIC NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transactions_source_ledger_idx ON transactions (source, ledger DESC);
ALTER TABLE events ADD COLUMN IF NOT EXISTS transaction_hash TEXT REFERENCES transactions(hash) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS events_transaction_hash_idx ON events(transaction_hash);
