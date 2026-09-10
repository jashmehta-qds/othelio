BEGIN;

CREATE TABLE IF NOT EXISTS lending_market_logs (
  id BIGSERIAL PRIMARY KEY,
  chain_id bigint NOT NULL,
  basket_address char(42),
  action text NOT NULL CHECK (action IN ('SUPPLY', 'BORROW', 'REPAY', 'WITHDRAW')),
  asset_address char(42) NOT NULL,
  amount numeric(38, 0) NOT NULL,
  winning_provider text NOT NULL,
  winning_pool char(42) NOT NULL,
  winning_supply_apy numeric(8, 4) NOT NULL DEFAULT 0,
  winning_borrow_apy numeric(8, 4) NOT NULL DEFAULT 0,
  all_market_quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lending_market_logs_lookup 
  ON lending_market_logs (chain_id, basket_address, winning_provider, created_at DESC);

COMMIT;
