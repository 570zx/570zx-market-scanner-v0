-- Read-only broker observation evidence.
-- No broker credentials, submit path, or live execution mode are introduced.

CREATE TABLE IF NOT EXISTS broker_observation_cycles(
  created_at TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  phase TEXT NOT NULL,
  trading_day INTEGER NOT NULL,
  reconciliation_state TEXT NOT NULL,
  positions INTEGER NOT NULL,
  open_orders INTEGER NOT NULL,
  fills INTEGER NOT NULL,
  assets_checked INTEGER NOT NULL
);
