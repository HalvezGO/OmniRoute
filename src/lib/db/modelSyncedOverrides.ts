import { getDbInstance } from "./core";
import { invalidateDbCache } from "./readCache";

/**
 * Operator overrides for synced/imported models.
 *
 * A synced model is discovered from a provider's own /models endpoint and persisted
 * under namespace 'syncedAvailableModels'. Editing one (api format, supported
 * endpoints, vision capability, wire format) must NOT create a customModels entry —
 * the dedup path in the dashboard (`knownIds` from synced rows) would let the
 * imported copy win over the operator's row. Instead the edits are stored here and
 * merged onto the synced model at read time (see models.ts::getSyncedAvailableModels).
 *
 * Keys: "apiFormat" | "supportedEndpoints" | "supportsVision" | "targetFormat".
 * Values are JSON-encoded in override_value.
 *
 * Writes bump the model-catalog cache version so the unified catalog
 * (/v1/models, /v1/images/generations, …) reflects the edit on the next read.
 */

export type ModelSyncedOverrideKey =
  "apiFormat" | "supportedEndpoints" | "supportsVision" | "targetFormat";

export interface ModelSyncedOverride {
  provider: string;
  modelId: string;
  key: ModelSyncedOverrideKey;
  value: unknown;
  refreshedAt: string;
}

interface OverrideRow {
  provider: string;
  model_id: string;
  override_key: string;
  override_value: string;
  refreshed_at: string;
}

const SUPPORTED_KEYS: readonly ModelSyncedOverrideKey[] = [
  "apiFormat",
  "supportedEndpoints",
  "supportsVision",
  "targetFormat",
];

function isSupportedKey(value: unknown): value is ModelSyncedOverrideKey {
  return typeof value === "string" && (SUPPORTED_KEYS as readonly string[]).includes(value);
}

function toOverride(row: OverrideRow): ModelSyncedOverride | null {
  if (!isSupportedKey(row.override_key)) return null;

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(row.override_value);
  } catch {
    return null;
  }

  return {
    provider: row.provider,
    modelId: row.model_id,
    key: row.override_key,
    value: parsedValue,
    refreshedAt: row.refreshed_at,
  };
}

/** A flat map modelId → overrides for a provider (or all providers). */
export type ModelSyncedOverrideMap = Map<string, Partial<Record<ModelSyncedOverrideKey, unknown>>>;

function rowsToFlatMap(rows: OverrideRow[]): ModelSyncedOverrideMap {
  const result: ModelSyncedOverrideMap = new Map();
  for (const row of rows) {
    if (!isSupportedKey(row.override_key)) continue;
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(row.override_value);
    } catch {
      continue;
    }
    const entry = result.get(row.model_id) ?? {};
    (entry as Record<string, unknown>)[row.override_key] = parsedValue;
    result.set(row.model_id, entry);
  }
  return result;
}

/** All synced-model overrides for a provider, keyed by modelId. Never throws. */
export function getModelSyncedOverrides(
  provider: string | null | undefined
): ModelSyncedOverrideMap {
  try {
    const rows = getDbInstance()
      .prepare(
        "SELECT provider, model_id, override_key, override_value, refreshed_at " +
          "FROM model_synced_overrides WHERE provider = ? ORDER BY refreshed_at DESC"
      )
      .all(provider) as OverrideRow[];
    return rowsToFlatMap(rows);
  } catch {
    return new Map();
  }
}

/** Full override rows for a single (provider, modelId). Never throws. */
export function getModelSyncedOverrideRow(
  provider: string,
  modelId: string
): ModelSyncedOverride[] {
  try {
    const rows = getDbInstance()
      .prepare(
        "SELECT provider, model_id, override_key, override_value, refreshed_at " +
          "FROM model_synced_overrides WHERE provider = ? AND model_id = ?"
      )
      .all(provider, modelId) as OverrideRow[];
    return rows.map(toOverride).filter((entry): entry is ModelSyncedOverride => entry !== null);
  } catch {
    return [];
  }
}

/** Write one override key for a synced model. Returns true when a row was written. */
export function setModelSyncedOverride(
  provider: string,
  modelId: string,
  key: ModelSyncedOverrideKey,
  value: unknown
): boolean {
  if (!provider || !modelId || !isSupportedKey(key)) return false;

  try {
    if (value === null || value === undefined || value === "") {
      // Clearing the override removes the row.
      const info = getDbInstance()
        .prepare(
          "DELETE FROM model_synced_overrides WHERE provider = ? AND model_id = ? AND override_key = ?"
        )
        .run(provider, modelId, key);
      if (info.changes > 0) invalidateDbCache("nodes");
      return info.changes > 0;
    }

    getDbInstance()
      .prepare(
        "INSERT OR REPLACE INTO model_synced_overrides " +
          "(provider, model_id, override_key, override_value, refreshed_at) " +
          "VALUES (?, ?, ?, ?, datetime('now'))"
      )
      .run(provider, modelId, key, JSON.stringify(value));
    invalidateDbCache("nodes");
    return true;
  } catch {
    // Table may not exist yet (pre-migration) — fail the write quietly.
    return false;
  }
}

/** Remove every override for a (provider, modelId). Returns true when any row was deleted. */
export function removeModelSyncedOverrides(provider: string, modelId: string): boolean {
  try {
    const info = getDbInstance()
      .prepare("DELETE FROM model_synced_overrides WHERE provider = ? AND model_id = ?")
      .run(provider, modelId);
    if (info.changes > 0) invalidateDbCache("nodes");
    return info.changes > 0;
  } catch {
    return false;
  }
}
