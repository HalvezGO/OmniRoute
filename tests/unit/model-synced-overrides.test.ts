import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// model_synced_overrides — operator edits for synced/imported models.
//
// A synced model is discovered from a provider's own /models endpoint and stored
// under key_value namespace 'syncedAvailableModels'. Editing one must NOT create a
// customModels entry (the dashboard dedup would let the imported copy shadow it).
// Instead edits persist in model_synced_overrides and are merged onto the synced
// rows at read time. This test proves the full chain:
//   1. getModelSyncedOverrides / setModelSyncedOverride CRUD
//   2. getSyncedAvailableModels / getAllSyncedAvailableModels merge the overrides
//   3. PUT /api/provider-models routes an imported-model edit to the overrides table
//   4. getResolvedModelCapabilities honors the synced vision override
//   5. images/generations POST resolves an imported image model

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-model-synced-overrides-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const syncedOverrides = await import("../../src/lib/db/modelSyncedOverrides.ts");
const modelCapabilities = await import("../../src/lib/modelCapabilities.ts");
const providerModelsRoute = await import("../../src/app/api/provider-models/route.ts");
const imageRoute = await import("../../src/app/api/v1/images/generations/route.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function buildRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/provider-models", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("setModelSyncedOverride writes and getModelSyncedOverrides reads it back", async () => {
  const wrote = syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "apiFormat",
    "images-generations"
  );
  assert.equal(wrote, true);

  const map = syncedOverrides.getModelSyncedOverrides("openai-compatible-demo");
  assert.equal(map.get("agnes-image-2.1-flash")?.apiFormat, "images-generations");

  // Clearing removes the row.
  const cleared = syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "apiFormat",
    null
  );
  assert.equal(cleared, true);
  assert.equal(syncedOverrides.getModelSyncedOverrides("openai-compatible-demo").size, 0);
});

test("getSyncedAvailableModels merges operator overrides onto the synced row", async () => {
  await modelsDb.replaceSyncedAvailableModelsForConnection("openai-compatible-demo", "conn-1", [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash" },
    { id: "agnes-chat-1", name: "Agnes Chat 1" },
  ]);
  syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "apiFormat",
    "images-generations"
  );
  syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "supportedEndpoints",
    ["images"]
  );
  syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "supportsVision",
    true
  );

  const merged = await modelsDb.getSyncedAvailableModels("openai-compatible-demo");
  const edited = merged.find((m) => m.id === "agnes-image-2.1-flash");
  assert.ok(edited, "synced model present after override merge");
  assert.equal(edited.apiFormat, "images-generations");
  assert.deepEqual(edited.supportedEndpoints, ["images"]);
  assert.equal(edited.supportsVision, true);

  // Untouched model stays as reported by the sync.
  const untouched = merged.find((m) => m.id === "agnes-chat-1");
  assert.equal(untouched?.apiFormat, undefined);
});

test("getAllSyncedAvailableModels merges overrides across providers", async () => {
  await modelsDb.replaceSyncedAvailableModelsForConnection("openai-compatible-demo", "conn-1", [
    { id: "agnes-image-2.1-flash", name: "Agnes Image" },
  ]);
  syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "targetFormat",
    "openai"
  );

  const all = await modelsDb.getAllSyncedAvailableModels();
  const row = all["openai-compatible-demo"]?.find((m) => m.id === "agnes-image-2.1-flash");
  assert.equal(row?.targetFormat, "openai");
});

test("PUT /api/provider-models persists an imported-model edit to model_synced_overrides", async () => {
  await modelsDb.replaceSyncedAvailableModelsForConnection("openai-compatible-demo", "conn-1", [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash" },
  ]);

  const putRes = await providerModelsRoute.PUT(
    buildRequest("PUT", {
      provider: "openai-compatible-demo",
      modelId: "agnes-image-2.1-flash",
      apiFormat: "images-generations",
      supportedEndpoints: ["images"],
      supportsVision: true,
    })
  );
  assert.equal(putRes.status, 200);
  const putBody = (await putRes.json()) as { syncedOverride?: boolean };
  assert.equal(putBody.syncedOverride, true);

  // The override landed in the table (not a customModels row).
  const overrideMap = syncedOverrides.getModelSyncedOverrides("openai-compatible-demo");
  const entry = overrideMap.get("agnes-image-2.1-flash");
  assert.equal(entry?.apiFormat, "images-generations");
  assert.deepEqual(entry?.supportedEndpoints, ["images"]);
  assert.equal(entry?.supportsVision, true);

  const customModels = await modelsDb.getCustomModels("openai-compatible-demo");
  assert.equal(customModels.length, 0, "no customModels row is created for the imported edit");
});

test("PUT for a non-synced, non-custom model still returns 404", async () => {
  const putRes = await providerModelsRoute.PUT(
    buildRequest("PUT", {
      provider: "openai-compatible-demo",
      modelId: "does-not-exist",
      apiFormat: "responses",
    })
  );
  assert.equal(putRes.status, 404);
});

test("getResolvedModelCapabilities honors the synced vision override", async () => {
  await modelsDb.replaceSyncedAvailableModelsForConnection("openai-compatible-demo", "conn-1", [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash" },
  ]);

  // No override yet → vision stays at the heuristic verdict (null here because
  // this id has no registry/spec/synced vision data).
  const before = modelCapabilities.getResolvedModelCapabilities({
    provider: "openai-compatible-demo",
    model: "agnes-image-2.1-flash",
  });
  assert.equal(before.supportsVision, null);

  syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "supportsVision",
    true
  );

  const after = modelCapabilities.getResolvedModelCapabilities({
    provider: "openai-compatible-demo",
    model: "agnes-image-2.1-flash",
  });
  assert.equal(after.supportsVision, true);
});

test("images/generations POST resolves a synced model with an images endpoint override", async () => {
  // The model is NOT in customModels and NOT in the built-in image registry. It
  // exists only as a synced/imported row whose supportedEndpoints was overridden
  // to include "images" (model_synced_overrides). The route must resolve it
  // instead of returning "Invalid image model".
  await modelsDb.replaceSyncedAvailableModelsForConnection("openai-compatible-demo", "conn-1", [
    { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash" },
  ]);
  syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "supportedEndpoints",
    ["images"]
  );
  syncedOverrides.setModelSyncedOverride(
    "openai-compatible-demo",
    "agnes-image-2.1-flash",
    "apiFormat",
    "images-generations"
  );

  await providersDb.createProviderConnection({
    provider: "openai-compatible-demo",
    authType: "apikey",
    name: "demo-conn",
    apiKey: "test-key",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      baseUrl: "https://demo.example.com/v1",
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const stringUrl = String(url);
    assert.equal(stringUrl, "https://demo.example.com/v1/images/generations");
    return new Response(
      JSON.stringify({ created: 1, data: [{ url: "https://cdn.example.com/x.png" }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await imageRoute.POST(
      new Request("http://localhost/api/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai-compatible-demo/agnes-image-2.1-flash",
          prompt: "a cat",
        }),
      })
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data?: Array<{ url?: string }> };
    assert.equal(body.data?.[0]?.url, "https://cdn.example.com/x.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
