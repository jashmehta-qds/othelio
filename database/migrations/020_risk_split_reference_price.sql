BEGIN;

ALTER TABLE risk_split_series
  ADD COLUMN IF NOT EXISTS creation_reference_price_usd_e8 numeric(78, 0),
  ADD COLUMN IF NOT EXISTS creation_feed_address char(42),
  ADD COLUMN IF NOT EXISTS creation_feed_round_id numeric(78, 0),
  ADD COLUMN IF NOT EXISTS creation_feed_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS creation_reference_block bigint,
  ADD COLUMN IF NOT EXISTS creation_reference_verified boolean NOT NULL DEFAULT false;

COMMIT;
