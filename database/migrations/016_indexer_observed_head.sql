BEGIN;

ALTER TABLE indexer_worker_state
  ADD COLUMN IF NOT EXISTS observed_head_block bigint,
  ADD COLUMN IF NOT EXISTS observed_head_at timestamptz;

ALTER TABLE indexer_worker_state
  DROP CONSTRAINT IF EXISTS indexer_worker_state_observed_head_block_check;

ALTER TABLE indexer_worker_state
  ADD CONSTRAINT indexer_worker_state_observed_head_block_check
  CHECK (observed_head_block IS NULL OR observed_head_block >= 0);

INSERT INTO schema_migrations (name)
VALUES ('016_indexer_observed_head.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
