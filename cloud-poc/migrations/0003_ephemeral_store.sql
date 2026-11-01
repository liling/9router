CREATE TABLE IF NOT EXISTS ephemeral_store (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  expires_at REAL NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_ephemeral_store_expires_at ON ephemeral_store(expires_at);
