BEGIN;

-- 1. Asset Price History Table (Stores time-series asset prices for 30d/24h return calculations)
CREATE TABLE IF NOT EXISTS asset_price_history (
  id BIGSERIAL PRIMARY KEY,
  chain_id bigint NOT NULL,
  asset_address char(42) NOT NULL,
  symbol text NOT NULL,
  price_in_token numeric(38, 18) NOT NULL,
  quote_symbol text NOT NULL DEFAULT 'USDC',
  quote_token_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asset_price_hist ON asset_price_history (chain_id, symbol, timestamp DESC);

-- 2. Basket Positions Table (Pre-aggregated volume-weighted cost basis & P&L state per asset)
CREATE TABLE IF NOT EXISTS basket_positions (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  asset_address char(42) NOT NULL,
  symbol text NOT NULL,
  units_held numeric(38, 18) NOT NULL DEFAULT 0,
  total_cost_basis_usdc numeric(38, 6) NOT NULL DEFAULT 0,
  avg_cost_usdc numeric(38, 6) NOT NULL DEFAULT 0,
  realized_pnl_usdc numeric(38, 6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, basket_address, asset_address)
);

COMMIT;
