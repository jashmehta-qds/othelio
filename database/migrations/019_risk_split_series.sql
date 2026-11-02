BEGIN;

-- 1. Risk-Split Series registry
CREATE TABLE IF NOT EXISTS risk_split_series (
  chain_id bigint NOT NULL,
  series_address char(42) NOT NULL,
  underlying_address char(42) NOT NULL,
  protected_token_address char(42),
  upside_token_address char(42),
  settlement_adapter_address char(42) NOT NULL,
  floor_price numeric(78, 0) NOT NULL,
  cap_price numeric(78, 0) NOT NULL,
  expiry_timestamp bigint NOT NULL,
  created_block bigint NOT NULL DEFAULT 0,
  created_tx char(66) NOT NULL DEFAULT '0x0000000000000000000000000000000000000000000000000000000000000000',
  is_settled boolean NOT NULL DEFAULT false,
  settled_price numeric(78, 0),
  protected_fraction numeric(78, 0),
  upside_fraction numeric(78, 0),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, series_address)
);

CREATE INDEX IF NOT EXISTS risk_split_series_underlying_idx
  ON risk_split_series(chain_id, underlying_address);

-- 2. Risk-Split Events
CREATE TABLE IF NOT EXISTS risk_split_events (
  chain_id bigint NOT NULL,
  tx_hash char(66) NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  series_address char(42) NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('SERIES_CREATED', 'MINTED', 'PAIR_REDEEMED', 'SETTLED', 'PROTECTED_REDEEMED', 'UPSIDE_REDEEMED')),
  actor_address char(42) NOT NULL,
  amount numeric(78, 0) NOT NULL,
  underlying_amount numeric(78, 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS risk_split_events_series_idx
  ON risk_split_events(chain_id, series_address, block_number DESC);

CREATE INDEX IF NOT EXISTS risk_split_events_actor_idx
  ON risk_split_events(chain_id, actor_address, block_number DESC);

-- 3. Risk-Split Positions (per user per series)
CREATE TABLE IF NOT EXISTS risk_split_positions (
  chain_id bigint NOT NULL,
  series_address char(42) NOT NULL,
  user_address char(42) NOT NULL,
  protected_balance numeric(78, 0) NOT NULL DEFAULT 0,
  upside_balance numeric(78, 0) NOT NULL DEFAULT 0,
  total_minted numeric(78, 0) NOT NULL DEFAULT 0,
  total_paired_redeemed numeric(78, 0) NOT NULL DEFAULT 0,
  total_protected_redeemed numeric(78, 0) NOT NULL DEFAULT 0,
  total_upside_redeemed numeric(78, 0) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, series_address, user_address)
);

COMMIT;
