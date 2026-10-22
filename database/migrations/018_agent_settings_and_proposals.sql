BEGIN;

CREATE TABLE IF NOT EXISTS agent_settings (
  account_address char(42) PRIMARY KEY,
  api_key_hash varchar(64) NOT NULL,
  autonomy_tier text NOT NULL DEFAULT 'staged',
  max_spend_per_tx_usd numeric(12, 2) NOT NULL DEFAULT 500.00,
  daily_spend_limit_usd numeric(12, 2) NOT NULL DEFAULT 2000.00,
  spent_today_usd numeric(12, 2) NOT NULL DEFAULT 0.00,
  spent_today_reset_at timestamptz NOT NULL DEFAULT now(),
  max_slippage_bps integer NOT NULL DEFAULT 50,
  allowed_assets text[] NOT NULL DEFAULT ARRAY['USDC', 'AAPLc', 'MSFTc', 'NVDAc', 'GOOGLc', 'AMZNc', 'METAc', 'TSLAc', 'MSTRc', 'SPCXc', 'SNDKc'],
  restrict_to_market_hours boolean NOT NULL DEFAULT true,
  min_rebalance_drift_bps integer NOT NULL DEFAULT 300,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_settings_api_key_hash_idx ON agent_settings(api_key_hash);

CREATE TABLE IF NOT EXISTS agent_proposals (
  id varchar(64) PRIMARY KEY,
  account_address char(42) NOT NULL,
  basket_address char(42),
  action text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  proposal_summary jsonb NOT NULL,
  transaction_call jsonb NOT NULL,
  calldata_hash varchar(66) NOT NULL,
  expires_at timestamptz NOT NULL,
  executed_tx_hash varchar(66),
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_account_status ON agent_proposals(account_address, status);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_expires ON agent_proposals(expires_at);

COMMIT;
