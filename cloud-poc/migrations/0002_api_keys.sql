CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT UNIQUE NOT NULL,
  name TEXT,
  machine_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  access_restricted INTEGER NOT NULL DEFAULT 0,
  access_allow TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
