-- MEDS live execution (Robinhood Agentic Trading).
-- Adds the Robinhood OAuth/MCP connection tables and the live mirror tables.
-- Live trading starts OFF (live_control.enabled=0). The operator turns it on
-- from the /live console after connecting Robinhood. Existing paper history
-- and the broker_* tables from 0010/0011 are unchanged. Live orders and fills
-- are journaled in broker_order_intents, broker_orders and broker_fills under
-- account_id RH_AGENTIC. Robinhood tokens are stored AES-GCM sealed.
-- Generated from ROBINHOOD_SCHEMA and LIVE_SCHEMA (tests keep them identical).

CREATE TABLE IF NOT EXISTS broker_oauth(
  id INTEGER PRIMARY KEY CHECK(id=1),mcp_url TEXT NOT NULL,resource TEXT NOT NULL,issuer TEXT NOT NULL,
  authorization_endpoint TEXT NOT NULL,token_endpoint TEXT NOT NULL,registration_endpoint TEXT,scope TEXT,
  client_id TEXT NOT NULL,client_secret_sealed TEXT,redirect_uri TEXT NOT NULL,registered_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS broker_oauth_pending(
  state TEXT PRIMARY KEY,verifier_sealed TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS broker_credentials(
  id INTEGER PRIMARY KEY CHECK(id=1),access_sealed TEXT NOT NULL,refresh_sealed TEXT,access_expires_at INTEGER,
  scope TEXT,obtained_at TEXT NOT NULL,refreshed_at TEXT,refresh_failures INTEGER NOT NULL DEFAULT 0,last_error TEXT);

CREATE TABLE IF NOT EXISTS broker_tool_catalog(
  name TEXT PRIMARY KEY,description TEXT,input_schema TEXT NOT NULL,fetched_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS broker_tool_shapes(
  tool TEXT PRIMARY KEY,shape TEXT NOT NULL,is_error INTEGER NOT NULL DEFAULT 0,captured_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS live_control(
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  halted_reason TEXT,
  max_capital REAL NOT NULL DEFAULT 250 CHECK(max_capital>0),
  max_order_notional REAL NOT NULL DEFAULT 12 CHECK(max_order_notional>0),
  max_orders_per_day INTEGER NOT NULL DEFAULT 40 CHECK(max_orders_per_day>=0),
  daily_loss_limit REAL NOT NULL DEFAULT 15 CHECK(daily_loss_limit>0),
  order_ttl_seconds INTEGER NOT NULL DEFAULT 90 CHECK(order_ttl_seconds>=15),
  buy_limit_buffer_pct REAL NOT NULL DEFAULT 0.01 CHECK(buy_limit_buffer_pct>=0 AND buy_limit_buffer_pct<=0.05),
  sell_limit_buffer_pct REAL NOT NULL DEFAULT 0.02 CHECK(sell_limit_buffer_pct>=0 AND sell_limit_buffer_pct<=0.10),
  max_chase_pct REAL NOT NULL DEFAULT 0.02 CHECK(max_chase_pct>=0 AND max_chase_pct<=0.10),
  max_spread_pct REAL NOT NULL DEFAULT 0.03 CHECK(max_spread_pct>0 AND max_spread_pct<=0.20),
  request_ttl_seconds INTEGER NOT NULL DEFAULT 180 CHECK(request_ttl_seconds>=60),
  last_mirror_bucket TEXT,
  agent_label TEXT,
  lease_owner TEXT,
  lease_until INTEGER,
  updated_at TEXT NOT NULL);

INSERT OR IGNORE INTO live_control(id,updated_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE IF NOT EXISTS live_write_guard(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,checked_at INTEGER NOT NULL);

CREATE TRIGGER IF NOT EXISTS live_fence_v1 BEFORE INSERT ON live_write_guard
  WHEN NOT EXISTS(SELECT 1 FROM live_control WHERE id=1 AND lease_owner=NEW.owner AND lease_until>NEW.checked_at)
  BEGIN SELECT RAISE(ABORT,'live lease lost'); END;

CREATE TABLE IF NOT EXISTS live_mirror_requests(
  request_id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN('ENTRY','EXIT_FRACTION','EXIT_ALL')),
  fraction REAL,
  paper_notional REAL,
  paper_price REAL,
  reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN('NEW','ORDERED','SKIPPED','EXPIRED')),
  detail TEXT,
  client_order_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_live_mirror_state ON live_mirror_requests(state,decided_at);

CREATE TABLE IF NOT EXISTS live_positions(
  symbol TEXT PRIMARY KEY,
  quantity TEXT NOT NULL,
  cost_basis TEXT NOT NULL,
  realized_pnl TEXT NOT NULL DEFAULT '0.00000000',
  opened_at TEXT,
  updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS live_daily(
  session_date TEXT PRIMARY KEY,
  pnl_start REAL,
  pnl_last REAL,
  orders INTEGER NOT NULL DEFAULT 0,
  buys_blocked TEXT,
  updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS live_sync(
  id INTEGER PRIMARY KEY CHECK(id=1),
  synced_at TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
  error TEXT,
  buying_power REAL,
  cash REAL,
  equity REAL,
  owned TEXT,
  broker_positions TEXT,
  reconciliation TEXT,
  mismatch_symbols TEXT,
  day_pnl REAL,
  total_pnl REAL,
  last_result TEXT);

INSERT OR IGNORE INTO live_sync(id) VALUES(1);
