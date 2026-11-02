CREATE TABLE IF NOT EXISTS worker_connections (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  secret_name TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  enabled_models TEXT NOT NULL DEFAULT '[]',
  cooldown_until TEXT,
  unavailable_until TEXT,
  unavailable_status TEXT,
  unavailable_model TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_connections_provider
  ON worker_connections(provider_id, is_active, priority, id);

CREATE TABLE IF NOT EXISTS worker_provider_settings (
  provider_id TEXT PRIMARY KEY NOT NULL,
  selection_strategy TEXT NOT NULL DEFAULT 'fill_first'
);
