PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  next_action TEXT,
  notes TEXT,
  last_event_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_milestones (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner_agent TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS content_ideas (
  id TEXT PRIMARY KEY,
  source_event TEXT,
  channel TEXT NOT NULL,
  concept TEXT NOT NULL,
  hook TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'yellow',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ai_calls INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS revenue_events (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  value_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON events(processed_at, created_at);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority, due_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent, started_at);

INSERT OR REPLACE INTO project_milestones(key, value, status, notes, updated_at) VALUES
('project_001.front_lip', 'printed', 'complete', 'Front lip officially printed.', '2026-09-17T03:30:00Z'),
('project_001.rear_bumper', 'remaining', 'open', 'Major print still remaining.', '2026-09-17T03:30:00Z'),
('project_001.diffuser', 'remaining', 'open', 'Major print still remaining.', '2026-09-17T03:30:00Z'),
('project_001.priority', 'finish Project 001 before expansion', 'active', 'Project 001 completion outranks future Kinetic work.', '2026-09-17T03:30:00Z');

INSERT OR REPLACE INTO partners(id, name, status, next_action, notes, last_event_at, updated_at) VALUES
('juggerbot', 'JuggerBot 3D', 'meeting_scheduled', 'Prepare for Sept 17 12:30 PM ET call; seek a concrete Project 001 pilot next step.', 'Technical LFAM conversation with Ben Toomey and Dan.', '2026-09-15T22:02:50Z', '2026-09-17T03:30:00Z'),
('modix', 'Modix', 'waiting_on_reply', 'Wait for Adam after corrected application package; do not chase.', 'BIG-180X platform partnership discussion. Package sent Sept 16.', '2026-09-17T02:05:00Z', '2026-09-17T03:30:00Z'),
('direct-connection', 'Direct Connection', 'formal_review', 'Wait for review unless they request more information.', 'Formal sponsorship proposal submitted.', '2026-09-11T20:39:31Z', '2026-09-17T03:30:00Z'),
('morimoto', 'Morimoto Lighting', 'active_development', 'Wait for hardware/shipping update.', 'Custom Z32 lighting development collaboration.', '2026-09-15T13:56:09Z', '2026-09-17T03:30:00Z'),
('3dxtech', '3DXTECH', 'active_material_partner', 'No action required right now.', 'Project 001 Material Partner.', '2026-09-16T00:00:00Z', '2026-09-17T03:30:00Z'),
('deatschwerks', 'DeatschWerks', 'needs_technical_specs', 'Answer horsepower target and fuel type when powertrain direction is ready.', 'Open technical thread; lower priority than current machine-partner work.', '2026-09-15T15:51:00Z', '2026-09-17T03:30:00Z'),
('qidi', 'QIDI', 'parked', 'No action unless Dodge explicitly reopens.', 'Paused by Dodge.', '2026-09-16T14:37:00Z', '2026-09-17T03:30:00Z');
