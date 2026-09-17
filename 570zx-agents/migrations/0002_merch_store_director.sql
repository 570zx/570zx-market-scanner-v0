CREATE TABLE IF NOT EXISTS store_metrics (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  site_clicks INTEGER NOT NULL DEFAULT 0,
  product_views INTEGER NOT NULL DEFAULT 0,
  add_to_carts INTEGER NOT NULL DEFAULT 0,
  checkouts INTEGER NOT NULL DEFAULT 0,
  purchases INTEGER NOT NULL DEFAULT 0,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merch_experiments (
  id TEXT PRIMARY KEY,
  source_event TEXT,
  title TEXT NOT NULL,
  hypothesis TEXT,
  proposal_json TEXT NOT NULL,
  primary_metric TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  approval_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_store_metrics_captured ON store_metrics(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_merch_experiments_status ON merch_experiments(status, created_at DESC);
