CREATE TABLE service_state (id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 0, last_tick_at TEXT, last_success_at TEXT, last_source TEXT, last_result TEXT, last_error TEXT, lock_owner TEXT, lock_until INTEGER);
INSERT INTO service_state(id) VALUES(1);
CREATE TABLE position_events(event_key TEXT PRIMARY KEY, created_at TEXT NOT NULL, symbol TEXT NOT NULL, price REAL NOT NULL, remaining_qty REAL NOT NULL, realized_pnl REAL NOT NULL, description TEXT NOT NULL);
CREATE TABLE alert_delivery(event_key TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL);
CREATE INDEX idx_alert_created ON alert_delivery(created_at);
CREATE INDEX idx_signal_created ON signals(created_at);
CREATE INDEX idx_state_seen ON symbol_state(last_seen_at);
