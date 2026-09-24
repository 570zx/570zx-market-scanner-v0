-- MEDS v8.5 paper session risk governor.
-- Adds observable, fail-closed session risk state; does not enable brokerage execution.
CREATE TABLE IF NOT EXISTS leader_session_risk(
  session_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  start_equity REAL,
  start_realized_pnl REAL NOT NULL,
  realized_pnl_today REAL NOT NULL DEFAULT 0,
  entries INTEGER NOT NULL DEFAULT 0,
  turnover REAL NOT NULL DEFAULT 0,
  max_drawdown_pct REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'NORMAL',
  breach_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_date,account_id)
);

UPDATE leader_runtime_config
SET account_id='H250',
    version='leader-hunt-v8.5-risk-governor',
    normal_enabled=0
WHERE id=1;

UPDATE paper_meta SET version=13 WHERE id=1;
