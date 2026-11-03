-- database/migrations/022_risk_split_orders.sql
-- Offchain signed limit orders, depth tracking, and trade execution logs for Risk Split markets

CREATE TABLE IF NOT EXISTS risk_split_orders (
  order_hash VARCHAR(66) PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  series_address VARCHAR(42) NOT NULL,
  claim_type VARCHAR(16) NOT NULL CHECK (claim_type IN ('PROTECTED', 'UPSIDE')),
  claim_token VARCHAR(42) NOT NULL,
  quote_token VARCHAR(42) NOT NULL,
  side VARCHAR(8) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  maker_address VARCHAR(42) NOT NULL,
  taker_address VARCHAR(42) NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
  maker_token VARCHAR(42) NOT NULL,
  taker_token VARCHAR(42) NOT NULL,
  maker_amount NUMERIC NOT NULL CHECK (maker_amount > 0),
  taker_amount NUMERIC NOT NULL CHECK (taker_amount > 0),
  remaining_maker_amount NUMERIC NOT NULL CHECK (remaining_maker_amount >= 0),
  remaining_taker_amount NUMERIC NOT NULL CHECK (remaining_taker_amount >= 0),
  price_usd_e6 NUMERIC NOT NULL CHECK (price_usd_e6 > 0),
  expiry_timestamp BIGINT NOT NULL,
  salt NUMERIC NOT NULL,
  verifying_contract VARCHAR(42) NOT NULL,
  signature JSONB NOT NULL,
  order_status VARCHAR(20) NOT NULL DEFAULT 'FILLABLE' CHECK (order_status IN ('FILLABLE', 'FILLED', 'CANCELLED', 'EXPIRED', 'LOCALLY_HIDDEN', 'INVALID')),
  is_locally_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_split_orders_book
  ON risk_split_orders (chain_id, LOWER(series_address), claim_type, order_status, side, price_usd_e6, created_at);

CREATE INDEX IF NOT EXISTS idx_risk_split_orders_maker
  ON risk_split_orders (chain_id, LOWER(maker_address), order_status);

CREATE TABLE IF NOT EXISTS risk_split_trades (
  id BIGSERIAL PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  series_address VARCHAR(42) NOT NULL,
  claim_type VARCHAR(16) NOT NULL CHECK (claim_type IN ('PROTECTED', 'UPSIDE')),
  order_hash VARCHAR(66) NOT NULL REFERENCES risk_split_orders(order_hash) ON DELETE CASCADE,
  maker_address VARCHAR(42) NOT NULL,
  taker_address VARCHAR(42) NOT NULL,
  side VARCHAR(8) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  fill_taker_amount NUMERIC NOT NULL CHECK (fill_taker_amount > 0),
  fill_maker_amount NUMERIC NOT NULL CHECK (fill_maker_amount > 0),
  price_usd_e6 NUMERIC NOT NULL CHECK (price_usd_e6 > 0),
  tx_hash VARCHAR(66),
  block_number BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_split_trades_series
  ON risk_split_trades (chain_id, LOWER(series_address), claim_type, occurred_at DESC);
