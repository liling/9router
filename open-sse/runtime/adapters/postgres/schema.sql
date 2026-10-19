CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT UNIQUE NOT NULL,
  name TEXT,
  machine_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL,
  access_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  access_allow JSONB NOT NULL DEFAULT '[]'::jsonb
);
