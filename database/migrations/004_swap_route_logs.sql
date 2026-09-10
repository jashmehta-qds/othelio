BEGIN;

CREATE TABLE IF NOT EXISTS swap_route_logs (
  id BIGSERIAL PRIMARY KEY,
  chain_id bigint NOT NULL,
  basket_address char(42),
  action text NOT NULL CHECK (action IN ('MINT', 'DEPOSIT', 'WITHDRAW', 'REBALANCE')),
  sell_token char(42) NOT NULL,
  buy_token char(42) NOT NULL,
  sell_amount numeric(38, 0) NOT NULL,
  winning_provider text NOT NULL,
  winning_router char(42) NOT NULL,
  winning_buy_amount numeric(38, 0) NOT NULL,
  estimated_gas_usd numeric(18, 6) NOT NULL DEFAULT 0,
  net_buy_amount_usd numeric(18, 6) NOT NULL DEFAULT 0,
  all_quotes jsonb NOT NULL,
  slippage_bps integer NOT NULL,
  executed_tx_hash char(66),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swap_route_logs_lookup 
  ON swap_route_logs (chain_id, basket_address, winning_provider, created_at DESC);

COMMIT;
