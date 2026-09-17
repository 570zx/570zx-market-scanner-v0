CREATE TABLE IF NOT EXISTS symbol_state (
  symbol TEXT PRIMARY KEY,
  last_price REAL,
  last_bid REAL,
  last_ask REAL,
  day_volume REAL,
  previous_day_volume REAL,
  last_minute_volume REAL,
  score REAL,
  status TEXT,
  consecutive_hits INTEGER DEFAULT 0,
  last_seen_at TEXT,
  last_alert_at TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  symbol TEXT NOT NULL,
  score REAL NOT NULL,
  status TEXT NOT NULL,
  price REAL,
  bid REAL,
  ask REAL,
  day_change_pct REAL,
  spread_pct REAL,
  volume_accel REAL,
  catalyst_score REAL,
  borrow_fee REAL,
  short_interest_pct REAL,
  borrow_available REAL,
  reasons TEXT,
  catalyst_summary TEXT,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS shadow_positions (
  symbol TEXT PRIMARY KEY,
  opened_at TEXT NOT NULL,
  entry_price REAL NOT NULL,
  quantity REAL NOT NULL,
  remaining_qty REAL NOT NULL,
  highest_price REAL NOT NULL,
  realized_pnl REAL DEFAULT 0,
  status TEXT NOT NULL,
  first_tp_done INTEGER DEFAULT 0,
  second_tp_done INTEGER DEFAULT 0,
  stop_price REAL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS daily_stats (
  trading_date TEXT PRIMARY KEY,
  signals INTEGER DEFAULT 0,
  paper_realized_pnl REAL DEFAULT 0,
  max_drawdown REAL DEFAULT 0,
  ai_calls INTEGER DEFAULT 0,
  alert_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_signals_symbol_time ON signals(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_score_time ON signals(score DESC, created_at DESC);
