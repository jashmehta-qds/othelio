BEGIN;

-- `total_nav_usdc` predates canonical valuation and may contain values copied
-- from an execution event. The metadata below makes the source and scope of
-- every new snapshot explicit rather than silently mixing those meanings.
ALTER TABLE basket_snapshots
  ADD COLUMN IF NOT EXISTS valuation_scope text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS valuation_source text NOT NULL DEFAULT 'LEGACY_EVENT',
  ADD COLUMN IF NOT EXISTS valuation_status text NOT NULL DEFAULT 'UNAVAILABLE',
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;

ALTER TABLE basket_snapshots
  DROP CONSTRAINT IF EXISTS basket_snapshots_valuation_scope_check;
ALTER TABLE basket_snapshots
  ADD CONSTRAINT basket_snapshots_valuation_scope_check
    CHECK (valuation_scope IN ('LEGACY', 'END_OF_BLOCK_SPOT'));

ALTER TABLE basket_snapshots
  DROP CONSTRAINT IF EXISTS basket_snapshots_valuation_source_check;
ALTER TABLE basket_snapshots
  ADD CONSTRAINT basket_snapshots_valuation_source_check
    CHECK (valuation_source IN ('LEGACY_EVENT', 'INDEXER_BLOCK_PINNED'));

ALTER TABLE basket_snapshots
  DROP CONSTRAINT IF EXISTS basket_snapshots_valuation_status_check;
ALTER TABLE basket_snapshots
  ADD CONSTRAINT basket_snapshots_valuation_status_check
    CHECK (valuation_status IN ('COMPLETE', 'UNAVAILABLE'));

CREATE INDEX IF NOT EXISTS basket_snapshots_canonical_lookup_idx
  ON basket_snapshots (chain_id, basket_address, block_number DESC)
  WHERE valuation_source = 'INDEXER_BLOCK_PINNED';

COMMIT;
