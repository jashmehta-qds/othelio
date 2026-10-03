BEGIN;

-- Durable operational state is deliberately separate from the append-only fact
-- tables.  The event worker keeps indexer_state for compatibility; these rows
-- give each independent worker its own checkpoint and failure boundary.
CREATE TABLE IF NOT EXISTS indexer_worker_state (
  chain_id bigint NOT NULL,
  worker_name text NOT NULL CHECK (worker_name IN ('events', 'prices', 'reconciliation', 'nav_rollup')),
  next_block bigint NOT NULL DEFAULT 0 CHECK (next_block >= 0),
  last_success_block bigint,
  last_success_hash char(66),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error text,
  cursor_basket char(42),
  cursor_asset char(42),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, worker_name)
);

CREATE TABLE IF NOT EXISTS indexer_reconciliation_state (
  chain_id bigint NOT NULL,
  basket_address char(42) NOT NULL,
  asset_address char(42) NOT NULL,
  last_checked_block bigint NOT NULL DEFAULT 0 CHECK (last_checked_block >= 0),
  last_checked_hash char(66),
  last_checked_at timestamptz,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETE', 'DEGRADED')),
  last_error text,
  PRIMARY KEY (chain_id, basket_address, asset_address),
  FOREIGN KEY (chain_id, basket_address) REFERENCES baskets(chain_id, address) ON DELETE CASCADE
);

ALTER TABLE indexer_worker_state ADD COLUMN IF NOT EXISTS cursor_basket char(42);
ALTER TABLE indexer_worker_state ADD COLUMN IF NOT EXISTS cursor_asset char(42);

CREATE TABLE IF NOT EXISTS indexer_projection_events (
  chain_id bigint NOT NULL,
  tx_hash char(66) NOT NULL,
  log_index integer NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

-- A failed delta projection must remain retryable.  Applied projection claims
-- are intentionally kept separate: a row is inserted into
-- indexer_projection_events only after every absolute position delta has been
-- written successfully.  Pending rows retain the complete reducer input so a
-- later bootstrap/reconciliation can replay it without rescanning an already
-- checkpointed range.
CREATE TABLE IF NOT EXISTS indexer_projection_pending (
  chain_id bigint NOT NULL,
  tx_hash char(66) NOT NULL,
  log_index integer NOT NULL,
  basket_address char(42) NOT NULL,
  block_number bigint NOT NULL,
  block_hash char(66) NOT NULL,
  event_type text NOT NULL,
  deltas jsonb NOT NULL,
  issue text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS indexer_projection_pending_pair_idx
  ON indexer_projection_pending (chain_id, basket_address, block_number, log_index);

-- basket_positions is an append-only version table.  The original primary key
-- omitted event identity, so two balance-changing logs for the same
-- basket/asset in one block overwrote each other.  Keep all historical rows by
-- extending the identity with transaction/log/version discriminators.
ALTER TABLE basket_positions
  ADD COLUMN IF NOT EXISTS event_tx_hash char(66),
  ADD COLUMN IF NOT EXISTS event_log_index integer,
  ADD COLUMN IF NOT EXISTS position_version bigint;

-- Rows written before this migration do not have receipt identity.  Preserve
-- them with a deterministic, lossless fallback: their canonical block hash is
-- the identity and EVENT/RECONCILIATION use separate version values.  New rows
-- always write their real transaction/log identity below in the indexer.
UPDATE basket_positions
SET event_tx_hash = COALESCE(event_tx_hash, block_hash),
    event_log_index = COALESCE(event_log_index, CASE WHEN source = 'EVENT' THEN 0 ELSE -1 END),
    position_version = COALESCE(position_version, CASE WHEN source = 'EVENT' THEN 0 ELSE -1 END)
WHERE event_tx_hash IS NULL
   OR event_log_index IS NULL
   OR position_version IS NULL;

ALTER TABLE basket_positions
  ALTER COLUMN event_tx_hash SET NOT NULL,
  ALTER COLUMN event_log_index SET NOT NULL,
  ALTER COLUMN position_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'basket_positions'::regclass
      AND conname = 'basket_positions_position_version_check'
  ) THEN
    ALTER TABLE basket_positions
      ADD CONSTRAINT basket_positions_position_version_check
      CHECK (position_version >= -1 AND event_log_index >= -1);
  END IF;
END $$;

-- Replace the block-only primary key.  Dropping/recreating this named
-- constraint is safe on repeated execution and leaves the migration
-- idempotent for disposable databases.
ALTER TABLE basket_positions DROP CONSTRAINT IF EXISTS basket_positions_pkey;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'basket_positions'::regclass
      AND conname = 'basket_positions_pkey'
  ) THEN
    ALTER TABLE basket_positions
      ADD CONSTRAINT basket_positions_pkey
      PRIMARY KEY (chain_id, basket_address, asset_address, block_number,
                   event_tx_hash, event_log_index, position_version);
  END IF;
END $$;

DROP INDEX IF EXISTS basket_positions_latest_idx;
CREATE INDEX IF NOT EXISTS basket_positions_latest_idx
  ON basket_positions (
    chain_id, basket_address, asset_address, block_number DESC,
    position_version DESC, event_log_index DESC, event_tx_hash DESC,
    observed_at DESC, block_hash DESC
  );

-- Canonical chain facts are recorded for every processed block, including
-- blocks with no application logs.  This is the source used to locate a
-- reorg ancestor; basket_events alone cannot represent empty blocks.
CREATE TABLE IF NOT EXISTS indexer_block_checkpoints (
  chain_id bigint NOT NULL,
  block_number bigint NOT NULL CHECK (block_number >= 0),
  block_hash char(66) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_number)
);

CREATE INDEX IF NOT EXISTS indexer_block_checkpoints_hash_idx
  ON indexer_block_checkpoints (chain_id, block_hash);

CREATE INDEX IF NOT EXISTS basket_positions_reconciliation_idx
  ON basket_positions (
    chain_id, basket_address, asset_address, block_number DESC,
    position_version DESC, event_log_index DESC, event_tx_hash DESC,
    observed_at DESC
  )
  WHERE source = 'RECONCILIATION';

CREATE INDEX IF NOT EXISTS indexer_worker_health_idx
  ON indexer_worker_state (chain_id, worker_name, last_success_at);

CREATE INDEX IF NOT EXISTS indexer_reconciliation_fairness_idx
  ON indexer_reconciliation_state (chain_id, last_checked_block, last_checked_at, basket_address, asset_address);

-- The event interface has more balance-changing events than the original
-- schema allowed.  Keep all of them in basket_events so replay has one source.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'basket_events'::regclass
      AND conname = 'basket_events_event_type_check'
  ) THEN
    ALTER TABLE basket_events DROP CONSTRAINT basket_events_event_type_check;
  END IF;
  ALTER TABLE basket_events ADD CONSTRAINT basket_events_event_type_check CHECK (event_type IN (
    'CREATED', 'FUNDED', 'WITHDRAWN', 'SWAP_WITHDRAWN', 'ASSET_SWEPT',
    'WEIGHTS_UPDATED', 'CONTROLLER_TRANSFERRED', 'DEX_ROUTE_EXECUTED',
    'SUPPLIED_TO_LENDING', 'BORROWED_FROM_LENDING', 'REPAID_TO_LENDING',
    'WITHDRAWN_FROM_LENDING'
  ));
END $$;

INSERT INTO schema_migrations (name)
VALUES ('015_indexer_worker_state.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
