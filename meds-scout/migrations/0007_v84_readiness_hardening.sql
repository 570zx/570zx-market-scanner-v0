-- MEDS v8.4 readiness hardening: persist rotation limits and enforce quote
-- freshness at the final atomic accounting boundary. No financial history is rewritten.
CREATE TABLE IF NOT EXISTS leader_daily_risk(
  session_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  rotations INTEGER NOT NULL DEFAULT 0,
  last_rotation_at TEXT,
  PRIMARY KEY(session_date,account_id)
);

CREATE TABLE IF NOT EXISTS leader_execution_guard(
  id INTEGER PRIMARY KEY CHECK(id=1),
  deadline_ms REAL NOT NULL,
  checked_at_ms REAL NOT NULL
);

CREATE TRIGGER IF NOT EXISTS leader_execution_deadline_v84
BEFORE INSERT ON leader_execution_guard
WHEN NEW.checked_at_ms > NEW.deadline_ms
BEGIN
  SELECT RAISE(ABORT,'execution quote expired at commit');
END;

UPDATE leader_runtime_config
SET account_id='H250',
    version='leader-hunt-v8.4-rotation-hardening',
    normal_enabled=0
WHERE id=1;
