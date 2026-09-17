BEGIN;

-- Pre-production schema reset for Pass 1: Lean, normalized valuation history.
-- Legacy tables `basket_snapshots`, `asset_price_history`, and legacy `basket_positions`
-- are dropped and replaced by canonical fact tables.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE name = '011_replace_legacy_valuation_schema.sql') THEN
    RAISE EXCEPTION '011_replace_legacy_valuation_schema.sql was already applied';
  END IF;
END $$;

DROP TABLE IF EXISTS basket_snapshots CASCADE;
DROP TABLE IF EXISTS asset_price_history CASCADE;
DROP TABLE IF EXISTS basket_positions CASCADE;

-- 1. basket_positions: exact versioned holdings
CREATE TABLE basket_positions (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  asset_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  block_timestamp timestamptz NOT NULL,
  quantity_base_units numeric(78, 0) NOT NULL,
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  source text NOT NULL CHECK (source IN ('EVENT', 'RECONCILIATION')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, basket_address, asset_address, block_number),
  FOREIGN KEY (chain_id, basket_address)
    REFERENCES baskets(chain_id, address) ON DELETE CASCADE
);

CREATE INDEX basket_positions_latest_idx
  ON basket_positions (chain_id, basket_address, asset_address, block_number DESC);

-- 2. asset_price_observations: shared canonical oracle facts
CREATE TABLE asset_price_observations (
  chain_id bigint NOT NULL,
  asset_address char(42) NOT NULL,
  feed_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  block_timestamp timestamptz NOT NULL,
  feed_round_id numeric(78, 0) NOT NULL,
  price_usd_e8 numeric(78, 0) NOT NULL,
  feed_updated_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, asset_address, block_number)
);

CREATE INDEX asset_price_observations_latest_idx
  ON asset_price_observations (chain_id, asset_address, block_number DESC);

-- 3. basket_nav_observations: compact graph-ready values
CREATE TABLE basket_nav_observations (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  block_timestamp timestamptz NOT NULL,
  position_block_number bigint NOT NULL,
  price_block_number bigint NOT NULL,
  nav_usdc numeric(38, 6),
  kind text NOT NULL CHECK (kind IN ('EVENT', 'HOURLY', 'RECONCILIATION')),
  valuation_status text NOT NULL CHECK (valuation_status IN ('COMPLETE', 'UNAVAILABLE')),
  issue text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, basket_address, block_number, kind),
  FOREIGN KEY (chain_id, basket_address)
    REFERENCES baskets(chain_id, address) ON DELETE CASCADE
);

CREATE INDEX basket_nav_history_idx
  ON basket_nav_observations (chain_id, basket_address, block_timestamp DESC)
  WHERE valuation_status = 'COMPLETE';

INSERT INTO schema_migrations (name)
VALUES ('011_replace_legacy_valuation_schema.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
