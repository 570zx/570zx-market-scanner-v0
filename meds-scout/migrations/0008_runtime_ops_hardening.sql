-- MEDS runtime operations hardening.
-- Compacts old raw Leader research while preserving per-symbol evidence.
CREATE TABLE IF NOT EXISTS leader_research_archive(
  session_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  version TEXT NOT NULL,
  evidence TEXT NOT NULL,
  PRIMARY KEY(session_date,symbol,version)
);

CREATE TABLE IF NOT EXISTS leader_session_summary(
  session_date TEXT NOT NULL,
  version TEXT NOT NULL,
  cycles INTEGER NOT NULL,
  audit_bytes INTEGER NOT NULL,
  compacted_at TEXT NOT NULL,
  PRIMARY KEY(session_date,version)
);

CREATE TABLE IF NOT EXISTS leader_maintenance_state(
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_maintenance_date TEXT
);
INSERT OR IGNORE INTO leader_maintenance_state(id,last_maintenance_date) VALUES(1,NULL);

CREATE TABLE IF NOT EXISTS leader_control_state(
  id INTEGER PRIMARY KEY CHECK(id=1),
  reduce_only INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO leader_control_state(id,reduce_only) VALUES(1,0);

UPDATE paper_meta SET version=12 WHERE id=1;
