BEGIN;

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS stale_price_trades text NOT NULL DEFAULT 'warn';

ALTER TABLE account_settings
  ADD CONSTRAINT account_settings_stale_price_trades_check
  CHECK (stale_price_trades IN ('allow', 'warn', 'reject'));

COMMIT;
