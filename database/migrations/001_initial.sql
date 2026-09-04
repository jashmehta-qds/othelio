BEGIN;
CREATE TABLE IF NOT EXISTS indexer_state (
  chain_id bigint PRIMARY KEY,
  next_block bigint NOT NULL CHECK (next_block >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS baskets (
  chain_id bigint NOT NULL,
  address char(42) NOT NULL,
  controller char(42) NOT NULL,
  name text NOT NULL,
  symbol text NOT NULL,
  created_block bigint NOT NULL,
  created_tx char(66) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (chain_id, address)
);
CREATE INDEX IF NOT EXISTS baskets_controller_idx ON baskets(chain_id, controller);
CREATE TABLE IF NOT EXISTS basket_assets (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  asset_address char(42) NOT NULL,
  target_weight_bps integer NOT NULL CHECK (target_weight_bps BETWEEN 0 AND 10000),
  updated_block bigint NOT NULL,
  PRIMARY KEY (chain_id, basket_address, asset_address),
  FOREIGN KEY (chain_id, basket_address) REFERENCES baskets(chain_id, address) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS basket_events (
  chain_id bigint NOT NULL,
  tx_hash char(66) NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  basket_address char(42) NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','FUNDED','WITHDRAWN','WEIGHTS_UPDATED','CONTROLLER_TRANSFERRED')),
  actor_address char(42),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS basket_events_lookup_idx ON basket_events(chain_id, basket_address, block_number DESC);
CREATE TABLE IF NOT EXISTS basket_snapshots (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  total_nav_usdc numeric(38, 6),
  shares_outstanding numeric(78, 0) NOT NULL,
  holdings jsonb NOT NULL,
  prices jsonb NOT NULL,
  priced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, basket_address, block_number)
);
CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  chain_id bigint NOT NULL,
  basket_address char(42),
  operation_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('PREPARED','SUBMITTED','CONFIRMED','REVERTED','EXPIRED')),
  request jsonb NOT NULL,
  prepared_transaction jsonb,
  tx_hash char(66),
  deadline timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;

