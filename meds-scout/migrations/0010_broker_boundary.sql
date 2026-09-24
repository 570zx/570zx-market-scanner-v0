-- Broker-boundary scaffolding for MEDS real-capital readiness.
-- There is deliberately no LIVE mode and live_execution is constrained to 0.
-- No credentials or broker connections are introduced by this migration.

CREATE TABLE IF NOT EXISTS broker_runtime_config(
  id INTEGER PRIMARY KEY CHECK(id=1),
  mode TEXT NOT NULL CHECK(mode IN('DISABLED','OBSERVE','PAPER')),
  live_execution INTEGER NOT NULL DEFAULT 0 CHECK(live_execution=0),
  account_id TEXT,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO broker_runtime_config(id,mode,live_execution,account_id,updated_at)
VALUES(1,'DISABLED',0,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE IF NOT EXISTS broker_order_intents(
  intent_id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  account_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  cycle_bucket TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK(asset_type IN('equity','option')),
  side TEXT NOT NULL CHECK(side IN('BUY','SELL')),
  order_type TEXT NOT NULL CHECK(order_type IN('MARKET','LIMIT')),
  time_in_force TEXT NOT NULL,
  quantity TEXT,
  notional TEXT,
  limit_price TEXT,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL,
  broker_order_id TEXT,
  last_error TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  CHECK((quantity IS NULL) <> (notional IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_broker_intent_state ON broker_order_intents(state,updated_at);

CREATE TABLE IF NOT EXISTS broker_transition_guard(
  id INTEGER PRIMARY KEY CHECK(id=1),
  client_order_id TEXT NOT NULL,
  expected_state TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS broker_transition_state_guard
BEFORE INSERT ON broker_transition_guard
WHEN NOT EXISTS(SELECT 1 FROM broker_order_intents WHERE client_order_id=NEW.client_order_id AND state=NEW.expected_state)
BEGIN
  SELECT RAISE(ABORT,'broker intent state conflict');
END;

CREATE TABLE IF NOT EXISTS broker_order_events(
  event_key TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broker_orders(
  broker_order_id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  state TEXT NOT NULL,
  quantity TEXT,
  filled_quantity TEXT,
  limit_price TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broker_fills(
  fill_id TEXT PRIMARY KEY,
  broker_order_id TEXT NOT NULL,
  client_order_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity TEXT NOT NULL,
  price TEXT NOT NULL,
  fee TEXT NOT NULL DEFAULT '0.00000000',
  filled_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_broker_fill_client ON broker_fills(client_order_id,filled_at);

CREATE TABLE IF NOT EXISTS broker_account_snapshots(
  snapshot_at TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  cash TEXT NOT NULL,
  buying_power TEXT NOT NULL,
  equity TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broker_position_snapshots(
  snapshot_at TEXT NOT NULL,
  symbol TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  quantity TEXT NOT NULL,
  avg_entry_price TEXT NOT NULL,
  market_value TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_at,symbol)
);

CREATE TABLE IF NOT EXISTS broker_asset_cache(
  symbol TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  status TEXT NOT NULL,
  tradable INTEGER NOT NULL,
  fractionable INTEGER NOT NULL,
  extended_hours INTEGER NOT NULL,
  overnight INTEGER NOT NULL,
  halted INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broker_reconciliations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN('MATCH','MISMATCH','UNAVAILABLE')),
  cash_match INTEGER NOT NULL,
  positions_match INTEGER NOT NULL,
  orders_match INTEGER NOT NULL,
  mismatches TEXT NOT NULL
);
