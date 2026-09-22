-- v8.4 readiness hardening: durable rotation controls and policy/version pin.
-- Additive only; historical accounts, positions, trades and events are untouched.
CREATE TABLE IF NOT EXISTS leader_rotation_state(
  account_id TEXT NOT NULL,
  session_date TEXT NOT NULL,
  rotations INTEGER NOT NULL DEFAULT 0,
  last_rotation_at TEXT,
  last_victim_symbol TEXT,
  last_replacement_symbol TEXT,
  version TEXT NOT NULL,
  PRIMARY KEY(account_id,session_date)
);
UPDATE leader_runtime_config
SET version='leader-hunt-v8.4-rotation-hardening'
WHERE id=1 AND account_id='H250' AND normal_enabled=0;
UPDATE paper_meta SET version=12 WHERE id=1;
