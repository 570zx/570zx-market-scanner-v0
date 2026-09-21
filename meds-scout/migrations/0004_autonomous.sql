-- Additive v8 infrastructure; safe on a fresh or existing database.
CREATE TABLE IF NOT EXISTS engine_write_guard(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, checked_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS engine_fence_v8 BEFORE INSERT ON engine_write_guard
    WHEN NOT EXISTS(SELECT 1 FROM service_state WHERE id=1 AND paused=0 AND lock_owner=NEW.owner AND lock_until>NEW.checked_at)
    BEGIN SELECT RAISE(ABORT,'engine lease lost or paused'); END;
CREATE TABLE IF NOT EXISTS engine_cycles(bucket TEXT PRIMARY KEY,started_at TEXT NOT NULL,completed_at TEXT,management_at TEXT,state TEXT NOT NULL,metrics TEXT NOT NULL DEFAULT '{}',version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quote_cache(asset TEXT NOT NULL,symbol TEXT NOT NULL,feed TEXT NOT NULL,quote_at TEXT NOT NULL,bid REAL NOT NULL,ask REAL NOT NULL,bid_size REAL,ask_size REAL,retrieved_at TEXT NOT NULL,PRIMARY KEY(asset,symbol));
CREATE TABLE IF NOT EXISTS quote_health(asset TEXT NOT NULL,symbol TEXT NOT NULL,state TEXT NOT NULL,quote_at TEXT,last_attempt_at TEXT NOT NULL,attempts INTEGER NOT NULL,error TEXT,PRIMARY KEY(asset,symbol));
CREATE TABLE IF NOT EXISTS portfolio_valuation_state(account_id TEXT PRIMARY KEY,created_at TEXT NOT NULL,cash REAL NOT NULL,live_equity REAL,known_value REAL NOT NULL,reporting_value REAL,complete INTEGER NOT NULL,marks TEXT NOT NULL,version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS candidate_decisions(bucket TEXT NOT NULL,created_at TEXT NOT NULL,symbol TEXT NOT NULL,lane TEXT NOT NULL,account_id TEXT NOT NULL DEFAULT '',stage TEXT NOT NULL,outcome TEXT NOT NULL,reasons TEXT NOT NULL,features TEXT NOT NULL,version TEXT NOT NULL,PRIMARY KEY(bucket,symbol,lane,account_id,stage,version));
CREATE INDEX IF NOT EXISTS idx_candidate_decision_symbol ON candidate_decisions(symbol,created_at);
CREATE TABLE IF NOT EXISTS research_outcomes(session_date TEXT NOT NULL,symbol TEXT NOT NULL,version TEXT NOT NULL,first_provider_at TEXT,first_seen_at TEXT,first_price REAL,first_change REAL,source TEXT,instrument_type TEXT NOT NULL,shortlisted_at TEXT,runner_at TEXT,executable_at TEXT,last_seen_at TEXT NOT NULL,high REAL,low REAL,latest_features TEXT NOT NULL,PRIMARY KEY(session_date,symbol,version));
CREATE TABLE IF NOT EXISTS mover_audits(bucket TEXT NOT NULL,symbol TEXT NOT NULL,session_date TEXT NOT NULL,phase TEXT NOT NULL,rank INTEGER NOT NULL,summary TEXT NOT NULL,version TEXT NOT NULL,PRIMARY KEY(bucket,symbol,version));
CREATE INDEX IF NOT EXISTS idx_mover_audit_session ON mover_audits(session_date,bucket,rank);
CREATE TABLE IF NOT EXISTS hunt_revisions(account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0);
