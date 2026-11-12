BEGIN;

-- 1. Update indexer_worker_state to support risksplit and upside workers
ALTER TABLE indexer_worker_state DROP CONSTRAINT IF EXISTS indexer_worker_state_worker_name_check;
ALTER TABLE indexer_worker_state ADD CONSTRAINT indexer_worker_state_worker_name_check
  CHECK (worker_name IN ('events', 'prices', 'reconciliation', 'nav_rollup', 'risksplit', 'upside'));

-- 2. Upside Rounds
CREATE TABLE IF NOT EXISTS upside_rounds (
  chain_id bigint NOT NULL,
  round_id bigint NOT NULL,
  factory_address char(42) NOT NULL,
  underlying_address char(42) NOT NULL,
  feed_address char(42) NOT NULL,
  adapter_address char(42) NOT NULL,
  reference_round_id numeric(78, 0) NOT NULL,
  reference_price numeric(78, 0) NOT NULL,
  reference_time bigint NOT NULL,
  round_start bigint NOT NULL,
  expiry_timestamp bigint NOT NULL,
  expected_move numeric(78, 0) NOT NULL,
  provenance_hash char(66) NOT NULL,
  strike_tick numeric(78, 0) NOT NULL,
  min_strike numeric(78, 0) NOT NULL,
  max_strike numeric(78, 0) NOT NULL,
  public_creation_enabled boolean NOT NULL DEFAULT false,
  created_block bigint NOT NULL,
  created_tx char(66) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, round_id)
);

CREATE INDEX IF NOT EXISTS idx_upside_rounds_underlying
  ON upside_rounds (chain_id, underlying_address, expiry_timestamp DESC);

-- 3. Upside Markets (Series)
CREATE TABLE IF NOT EXISTS upside_markets (
  chain_id bigint NOT NULL,
  series_address char(42) NOT NULL,
  round_id bigint NOT NULL,
  factory_address char(42) NOT NULL,
  underlying_address char(42) NOT NULL,
  upside_token_address char(42),
  residual_token_address char(42),
  strike_price numeric(78, 0) NOT NULL,
  expiry_timestamp bigint NOT NULL,
  is_settled boolean NOT NULL DEFAULT false,
  settled_price numeric(78, 0),
  settled_round_id numeric(78, 0),
  settled_timestamp bigint,
  collateral_snapshot numeric(78, 0),
  total_claim_supply_snapshot numeric(78, 0),
  upside_allocation numeric(78, 0),
  residual_allocation numeric(78, 0),
  creator_address char(42) NOT NULL,
  created_block bigint NOT NULL,
  created_tx char(66) NOT NULL,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, series_address),
  FOREIGN KEY (chain_id, round_id) REFERENCES upside_rounds(chain_id, round_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_upside_markets_round
  ON upside_markets (chain_id, round_id, strike_price);

CREATE INDEX IF NOT EXISTS idx_upside_markets_underlying
  ON upside_markets (chain_id, underlying_address, is_settled, expiry_timestamp);

-- 4. Upside Events
CREATE TABLE IF NOT EXISTS upside_events (
  chain_id bigint NOT NULL,
  tx_hash char(66) NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  series_address char(42) NOT NULL,
  round_id bigint NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('MARKET_CREATED', 'MINTED', 'PAIR_WITHDRAWN', 'SETTLED', 'UPSIDE_REDEEMED', 'RESIDUAL_REDEEMED', 'CLAIM_TRANSFER')),
  actor_address char(42) NOT NULL,
  amount numeric(78, 0) NOT NULL,
  underlying_amount numeric(78, 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_upside_events_series
  ON upside_events (chain_id, series_address, block_number DESC);

CREATE INDEX IF NOT EXISTS idx_upside_events_actor
  ON upside_events (chain_id, actor_address, block_number DESC);

-- 5. Upside Positions (per user per series)
CREATE TABLE IF NOT EXISTS upside_positions (
  chain_id bigint NOT NULL,
  series_address char(42) NOT NULL,
  user_address char(42) NOT NULL,
  upside_balance numeric(78, 0) NOT NULL DEFAULT 0,
  residual_balance numeric(78, 0) NOT NULL DEFAULT 0,
  total_minted numeric(78, 0) NOT NULL DEFAULT 0,
  total_pair_withdrawn numeric(78, 0) NOT NULL DEFAULT 0,
  total_upside_redeemed numeric(78, 0) NOT NULL DEFAULT 0,
  total_residual_redeemed numeric(78, 0) NOT NULL DEFAULT 0,
  cost_basis_usdc numeric(78, 6),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, series_address, user_address)
);

CREATE INDEX IF NOT EXISTS idx_upside_positions_user
  ON upside_positions (chain_id, user_address) WHERE (upside_balance > 0 OR residual_balance > 0);

COMMIT;
