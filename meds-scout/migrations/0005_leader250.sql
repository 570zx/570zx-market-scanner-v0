-- Additive v8.1 migration for the existing v8 database. No historical rows are changed.
CREATE TABLE IF NOT EXISTS leader_runtime_config(id INTEGER PRIMARY KEY CHECK(id=1),account_id TEXT NOT NULL,version TEXT NOT NULL,normal_enabled INTEGER NOT NULL CHECK(normal_enabled=0));
INSERT OR IGNORE INTO leader_runtime_config VALUES(1,'H250','leader-hunt-v8.1-leader250-capacity',0);
INSERT OR IGNORE INTO hunt_accounts(account_id,label,starting_equity,cash,current_equity,realized_pnl,max_equity,max_drawdown_pct,updated_at) VALUES('H250','$250',250,250,250,0,250,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT OR IGNORE INTO hunt_revisions VALUES('H250',0);
CREATE TABLE IF NOT EXISTS leader_cycle_audit(bucket TEXT PRIMARY KEY,created_at TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS leader_research_shards(session_date TEXT NOT NULL,shard INTEGER NOT NULL,version TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(session_date,shard,version));
CREATE INDEX IF NOT EXISTS idx_hunt_account_event_position ON hunt_account_events(account_id,position_id,event_type);
DROP INDEX IF EXISTS idx_hunt_account_event_time;
DROP TRIGGER IF EXISTS hunt_account_events_once_v8;
CREATE TRIGGER hunt_account_events_once_v8 BEFORE INSERT ON hunt_account_events WHEN EXISTS(SELECT 1 FROM hunt_account_events WHERE account_id=NEW.account_id AND position_id=NEW.position_id AND event_type=NEW.event_type) BEGIN SELECT RAISE(ABORT,'Leader lifecycle event already applied'); END;
CREATE INDEX IF NOT EXISTS idx_hunt_option_event_position ON hunt_account_option_events(account_id,position_id,event_type);
DROP INDEX IF EXISTS idx_hunt_option_event_time;
DROP TRIGGER IF EXISTS hunt_account_option_events_once_v8;
CREATE TRIGGER hunt_account_option_events_once_v8 BEFORE INSERT ON hunt_account_option_events WHEN EXISTS(SELECT 1 FROM hunt_account_option_events WHERE account_id=NEW.account_id AND position_id=NEW.position_id AND event_type=NEW.event_type) BEGIN SELECT RAISE(ABORT,'Leader lifecycle event already applied'); END;
UPDATE paper_meta SET version=11 WHERE id=1;
