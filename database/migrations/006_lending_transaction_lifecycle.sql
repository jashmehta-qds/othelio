BEGIN;

CREATE TABLE IF NOT EXISTS lending_transaction_lifecycles (
  operation_id text PRIMARY KEY,
  chain_id bigint NOT NULL,
  tx_hash char(66) NOT NULL,
  basket_address char(42) NOT NULL,
  requested_action text NOT NULL CHECK (requested_action IN ('SUPPLY', 'BORROW', 'REPAY', 'WITHDRAW')),
  requested_asset_address char(42) NOT NULL,
  requested_amount numeric(78, 0) NOT NULL,
  requested_provider text NOT NULL,
  requested_market_address char(42) NOT NULL,
  status text NOT NULL CHECK (status IN ('SUBMITTED', 'CONFIRMED_SUCCESS', 'CONFIRMED_REVERT', 'UNKNOWN')),
  confirmed_action text CHECK (confirmed_action IN ('SUPPLY', 'BORROW', 'REPAY', 'WITHDRAW')),
  confirmed_asset_address char(42),
  confirmed_amount numeric(78, 0),
  confirmed_market_address char(42),
  receipt_block_number bigint,
  receipt_block_hash char(66),
  receipt_log_index integer,
  reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash)
);

CREATE INDEX IF NOT EXISTS lending_transaction_lifecycle_basket_idx
  ON lending_transaction_lifecycles (chain_id, basket_address, submitted_at DESC);

ALTER TABLE lending_market_logs
  ALTER COLUMN amount TYPE numeric(78, 0),
  ALTER COLUMN winning_supply_apy DROP NOT NULL,
  ALTER COLUMN winning_borrow_apy DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS tx_hash char(66),
  ADD COLUMN IF NOT EXISTS log_index integer,
  ADD COLUMN IF NOT EXISTS block_number bigint,
  ADD COLUMN IF NOT EXISTS block_hash char(66),
  ADD COLUMN IF NOT EXISTS actor_address char(42);

CREATE UNIQUE INDEX IF NOT EXISTS lending_market_logs_receipt_idx
  ON lending_market_logs (chain_id, tx_hash, log_index)
  WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS basket_position_refresh_requests (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, basket_address, block_number)
);

COMMIT;
