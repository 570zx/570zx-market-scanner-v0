-- MEDS v8.5 account-level risk governor.
-- Existing financial history is preserved; new columns only track the current
-- session's safety envelope and do not enable brokerage execution.
ALTER TABLE leader_daily_risk ADD COLUMN session_start_equity REAL;
ALTER TABLE leader_daily_risk ADD COLUMN session_start_realized_pnl REAL;
ALTER TABLE leader_daily_risk ADD COLUMN realized_pnl REAL NOT NULL DEFAULT 0;
ALTER TABLE leader_daily_risk ADD COLUMN max_drawdown_pct REAL NOT NULL DEFAULT 0;
ALTER TABLE leader_daily_risk ADD COLUMN entries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leader_daily_risk ADD COLUMN entry_notional REAL NOT NULL DEFAULT 0;
ALTER TABLE leader_daily_risk ADD COLUMN risk_state TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE leader_daily_risk ADD COLUMN breach_reason TEXT;
ALTER TABLE leader_daily_risk ADD COLUMN updated_at TEXT;

UPDATE leader_runtime_config
SET account_id='H250',
    version='leader-hunt-v8.5-account-risk-governor',
    normal_enabled=0
WHERE id=1;

UPDATE paper_meta SET version=13 WHERE id=1;
