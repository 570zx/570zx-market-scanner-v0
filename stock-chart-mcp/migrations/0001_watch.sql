CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY,
  note TEXT,
  alert_above REAL,
  alert_below REAL,
  added_at TEXT NOT NULL
);

-- One row per symbol per watcher pass during the session.
CREATE TABLE IF NOT EXISTS snapshots (
  symbol TEXT NOT NULL,
  at TEXT NOT NULL,
  session_date TEXT NOT NULL,
  price REAL NOT NULL,
  change_pct REAL,
  vwap REAL,
  rsi REAL,
  trend TEXT,
  signals TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (symbol, at)
);
CREATE INDEX IF NOT EXISTS snapshots_by_day ON snapshots(symbol, session_date);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  at TEXT NOT NULL,
  session_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_by_time ON alerts(at);
