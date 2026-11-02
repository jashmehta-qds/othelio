BEGIN;

-- Add factory address, formula version, fixing metadata, and ops audit to risk_split_series
ALTER TABLE risk_split_series
  ADD COLUMN IF NOT EXISTS factory_address char(42),
  ADD COLUMN IF NOT EXISTS formula_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS settled_round_id numeric(78, 0),
  ADD COLUMN IF NOT EXISTS settled_feed_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS operations_audit_status text NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS operations_audit_note text,
  ADD COLUMN IF NOT EXISTS last_indexed_block bigint NOT NULL DEFAULT 0;

-- Expand event types to cover TOKENS_INITIALIZED, SETTLED_WITH_FIXING, and CLAIM_TRANSFER
ALTER TABLE risk_split_events
  DROP CONSTRAINT IF EXISTS risk_split_events_event_type_check;

ALTER TABLE risk_split_events
  ADD CONSTRAINT risk_split_events_event_type_check
  CHECK (event_type IN (
    'SERIES_CREATED',
    'TOKENS_INITIALIZED',
    'MINTED',
    'PAIR_REDEEMED',
    'SETTLED',
    'SETTLED_WITH_FIXING',
    'PROTECTED_REDEEMED',
    'UPSIDE_REDEEMED',
    'CLAIM_TRANSFER'
  ));

INSERT INTO schema_migrations (name)
VALUES ('021_risk_split_reference_fixing.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
