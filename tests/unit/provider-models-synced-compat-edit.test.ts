/**
 * A synced/imported model has no customModels row. Compat-only edits
 * (apiFormat/targetFormat/supportsVision) must persist to modelCompatOverrides
 * instead of creating a synthetic custom row that would shadow the discovered
 * metadata on the next catalog merge.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-synced-compat-edit-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET ?? "synced-compat-edit-test-secret";

const core = await import("../../src/lib/db/core.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const persistence = await import("../../src/lib/db/models/syncedAvailableModelPersistence.ts");
const providerModelsRoute = await import("../../src/app/api/provider-models/route.ts");

const PROVIDER = "openai-compatible-demo";
const CONNECTION = "conn-synced-compat";
const SYNCED_MODEL = "synced-model";

function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function seedSyncedModel(models: Array<Record<string, unknown>> = [{ id: SYNCED_MODEL }]) {
  persistence.persistCanonicalSyncedAvailableModels(`${PROVIDER}:${CONNECTION}`, models, (value) =>
    Array.isArray(value) ? value : []
  );
}

function buildRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/provider-models", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test.beforeEach(() => {
  resetStorage();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("PUT compat-only edit persists to modelCompatOverrides without creating a custom row", async () => {
  seedSyncedModel();

  const response = await providerModelsRoute.PUT(
    buildRequest("PUT", {
      provider: PROVIDER,
      modelId: SYNCED_MODEL,
      apiFormat: "responses",
      targetFormat: "claude",
      supportsVision: true,
    })
  );
  const body = (await response.json()) as { syncedOverride?: boolean };

  assert.equal(response.status, 200);
  assert.equal(body.syncedOverride, true);

  const override = modelsDb
    .getModelCompatOverrides(PROVIDER)
    .find((entry) => entry.id === SYNCED_MODEL);
  assert.ok(override, "compat override should be persisted");
  assert.equal(override!.apiFormat, "responses");
  assert.equal(override!.targetFormat, "claude");
  assert.equal(override!.supportsVision, true);

  const customModels = (await modelsDb.getCustomModels(PROVIDER)) as Array<{ id?: string }>;
  assert.equal(customModels.length, 0, "no synthetic customModels row may be created");

  const synced = await modelsDb.getSyncedAvailableModels(PROVIDER);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].apiFormat, "responses");
  assert.equal(synced[0].targetFormat, "claude");
  assert.equal(synced[0].supportsVision, true);

  const all = await modelsDb.getAllSyncedAvailableModels();
  assert.equal(all[PROVIDER]?.[0]?.apiFormat, "responses");
  assert.equal(all[PROVIDER]?.[0]?.supportsVision, true);
});

test("PUT supportsVision:null clears the compat override", async () => {
  seedSyncedModel();
  modelsDb.mergeModelCompatOverride(PROVIDER, SYNCED_MODEL, { supportsVision: true });

  const response = await providerModelsRoute.PUT(
    buildRequest("PUT", {
      provider: PROVIDER,
      modelId: SYNCED_MODEL,
      supportsVision: null,
    })
  );

  assert.equal(response.status, 200);
  assert.equal(
    modelsDb.getModelCompatOverrides(PROVIDER).some((entry) => entry.id === SYNCED_MODEL),
    false
  );
  const synced = await modelsDb.getSyncedAvailableModels(PROVIDER);
  assert.equal(synced[0].supportsVision, undefined);
});

test("a real custom model still updates its custom row, not the compat store", async () => {
  await modelsDb.addCustomModel(PROVIDER, "custom-model", "Custom Model");

  const response = await providerModelsRoute.PUT(
    buildRequest("PUT", {
      provider: PROVIDER,
      modelId: "custom-model",
      apiFormat: "responses",
    })
  );

  assert.equal(response.status, 200);
  const customModels = (await modelsDb.getCustomModels(PROVIDER)) as Array<{
    id?: string;
    apiFormat?: string;
  }>;
  const customModel = customModels.find((model) => model.id === "custom-model");
  assert.ok(customModel);
  assert.equal(customModel!.apiFormat, "responses");
  assert.equal(
    modelsDb.getModelCompatOverrides(PROVIDER).some((entry) => entry.id === "custom-model"),
    false
  );
});

test("an endpoint-override overlay does not swallow a later compat edit", async () => {
  seedSyncedModel();
  await modelsDb.updateCustomModel(
    PROVIDER,
    SYNCED_MODEL,
    { supportedEndpoints: ["chat", "embeddings"] },
    { createIfMissing: true }
  );

  const response = await providerModelsRoute.PUT(
    buildRequest("PUT", {
      provider: PROVIDER,
      modelId: SYNCED_MODEL,
      apiFormat: "responses",
    })
  );

  assert.equal(response.status, 200);
  const override = modelsDb
    .getModelCompatOverrides(PROVIDER)
    .find((entry) => entry.id === SYNCED_MODEL);
  assert.ok(override, "compat edit must reach the compat store");
  assert.equal(override!.apiFormat, "responses");

  const customModels = (await modelsDb.getCustomModels(PROVIDER)) as Array<{
    id?: string;
    source?: string;
    apiFormat?: string;
  }>;
  const endpointRow = customModels.find((model) => model.id === SYNCED_MODEL);
  assert.equal(endpointRow?.source, "endpoint-override");
  assert.equal(endpointRow?.apiFormat, undefined);
});

test("a custom row with the same id keeps precedence over the synced compat branch", async () => {
  seedSyncedModel();
  await modelsDb.addCustomModel(PROVIDER, SYNCED_MODEL, "Custom Wins");

  const response = await providerModelsRoute.PUT(
    buildRequest("PUT", {
      provider: PROVIDER,
      modelId: SYNCED_MODEL,
      apiFormat: "responses",
    })
  );

  assert.equal(response.status, 200);
  assert.equal(
    modelsDb.getModelCompatOverrides(PROVIDER).some((entry) => entry.id === SYNCED_MODEL),
    false,
    "the custom row owns the edit; the compat store must stay empty"
  );
  const customModels = (await modelsDb.getCustomModels(PROVIDER)) as Array<{
    id?: string;
    apiFormat?: string;
  }>;
  assert.equal(customModels.find((model) => model.id === SYNCED_MODEL)?.apiFormat, "responses");
});
