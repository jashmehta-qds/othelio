BEGIN;

ALTER TABLE lending_transaction_lifecycles
  ADD COLUMN IF NOT EXISTS original_tx_hash char(66),
  ADD COLUMN IF NOT EXISTS active_tx_hash char(66),
  ADD COLUMN IF NOT EXISTS replacement_tx_hash char(66),
  ADD COLUMN IF NOT EXISTS sender_address char(42),
  ADD COLUMN IF NOT EXISTS tx_nonce bigint,
  ADD COLUMN IF NOT EXISTS missing_receipt_observations integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_observed_at timestamptz;

UPDATE lending_transaction_lifecycles
SET original_tx_hash = COALESCE(original_tx_hash, tx_hash), active_tx_hash = COALESCE(active_tx_hash, tx_hash);

ALTER TABLE lending_transaction_lifecycles
  ALTER COLUMN original_tx_hash SET NOT NULL,
  ALTER COLUMN active_tx_hash SET NOT NULL;

ALTER TABLE lending_transaction_lifecycles DROP CONSTRAINT IF EXISTS lending_transaction_lifecycles_status_check;
ALTER TABLE lending_transaction_lifecycles
  ADD CONSTRAINT lending_transaction_lifecycles_status_check CHECK (status IN ('SUBMITTED','CONFIRMED_SUCCESS','CONFIRMED_REVERT','REPLACED','DROPPED','UNKNOWN','REORG_INVALIDATED'));

CREATE INDEX IF NOT EXISTS lending_transaction_lifecycles_unsettled_idx
  ON lending_transaction_lifecycles (chain_id, status, submitted_at)
  WHERE status IN ('SUBMITTED','REORG_INVALIDATED');
COMMIT;
