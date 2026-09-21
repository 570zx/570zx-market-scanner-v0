-- MEDS v8.1 Leader-only capacity migration.
-- Preserve all historical accounts/trades/positions; only H250 is registered for new runtime work.
CREATE TABLE IF NOT EXISTS leader_runtime_accounts(
  account_id TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1,
  role TEXT NOT NULL DEFAULT 'leader',
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO hunt_accounts(
  account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at
) VALUES(
  'H250','$250',250,250,250,0,250,0,strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

INSERT OR REPLACE INTO leader_runtime_accounts(account_id,active,role,created_at)
VALUES(
  'H250',1,'leader',
  COALESCE((SELECT created_at FROM leader_runtime_accounts WHERE account_id='H250'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO hunt_revisions(account_id,revision) VALUES('H250',0);
UPDATE paper_meta SET version=11 WHERE id=1;
