BEGIN;

-- Cost basis is a derived accounting projection, not a property of a historical
-- balance observation. These tables are intentionally sufficient for a future
-- lot-based projector without making any FIFO or tax-reporting claim today.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  tx_hash char(66) NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ACQUISITION', 'REDUCTION', 'TRANSFER_OUT', 'ADJUSTMENT')),
  asset_address char(42) NOT NULL,
  quantity_base_units numeric(78, 0) NOT NULL CHECK (quantity_base_units >= 0),
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  basis_delta_usdc_micro numeric(78, 0) NOT NULL,
  valuation_source text NOT NULL CHECK (valuation_source IN ('USDC_RECEIPT', 'ORACLE_AT_EXECUTION', 'NONE')),
  status text NOT NULL CHECK (status IN ('COMPLETE', 'INCOMPLETE')),
  issue text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index, kind, asset_address),
  FOREIGN KEY (chain_id, basket_address)
    REFERENCES baskets(chain_id, address) ON DELETE CASCADE
);

CREATE INDEX accounting_events_basket_order_idx
  ON accounting_events (chain_id, basket_address, block_number, log_index, created_at);

CREATE TABLE asset_cost_basis (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  asset_address char(42) NOT NULL,
  quantity_base_units numeric(78, 0) NOT NULL CHECK (quantity_base_units >= 0),
  decimals smallint NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  open_basis_usdc_micro numeric(78, 0) NOT NULL CHECK (open_basis_usdc_micro >= 0),
  accounting_status text NOT NULL CHECK (accounting_status IN ('COMPLETE', 'INCOMPLETE')),
  issue text,
  last_event_id uuid REFERENCES accounting_events(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, basket_address, asset_address),
  FOREIGN KEY (chain_id, basket_address)
    REFERENCES baskets(chain_id, address) ON DELETE CASCADE,
  CHECK ((quantity_base_units = 0 AND open_basis_usdc_micro = 0) OR quantity_base_units > 0)
);

CREATE INDEX asset_cost_basis_basket_idx
  ON asset_cost_basis (chain_id, basket_address, accounting_status);

COMMIT;
