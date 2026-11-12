BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS risk_split_trades_order_tx_unique
  ON risk_split_trades (order_hash, tx_hash)
  WHERE tx_hash IS NOT NULL;

COMMIT;
