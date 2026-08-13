-- 134_model_synced_overrides.sql
-- Operator overrides for synced/imported models (models discovered from a provider's
-- own /models endpoint and persisted under namespace 'syncedAvailableModels').
--
-- These edits (api format, supported endpoints, vision capability, wire format) are
-- written here rather than into the customModels store so an operator-edited imported
-- model is not shadowed by the synced copy during dedup (customModels entries with an
-- id that also exists in syncedAvailableModels lose to the imported row). Overrides
-- are merged onto the synced model on read.
--
-- Follows the model_capability_overrides shape: (provider, model_id, override_key) PK
-- with the value serialized as JSON in override_value.

CREATE TABLE IF NOT EXISTS model_synced_overrides (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  override_key TEXT NOT NULL,
  override_value TEXT NOT NULL,          -- JSON-encoded value for the key
  refreshed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, model_id, override_key)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_model_synced_overrides_key
  ON model_synced_overrides (override_key);
