BEGIN;

CREATE TABLE IF NOT EXISTS account_settings (
  account_address char(42) PRIMARY KEY,
  slippage_tolerance numeric(5, 2) NOT NULL DEFAULT 0.50,
  deadline_minutes integer NOT NULL DEFAULT 20,
  mev_protection boolean NOT NULL DEFAULT true,
  risk_tier text NOT NULL DEFAULT 'safe',
  custom_risk_buffer numeric(5, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_settings_address_idx ON account_settings(account_address);

COMMIT;
