import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #9526 — /v1/models prefix-mode semantics for compatible-provider nodes.
//
// A compatible provider node has two legitimate public prefixes:
//   - alias:  the operator-configured `prefix` (e.g. "bmok-ocg")
//   - canonical: the full provider-node id (e.g. "openai-compatible-chat-<uuid>")
//
// MODELS_CATALOG_PREFIX_MODE is a strict three-way switch, and it must apply to
// alias-backed rows exactly like the synced/custom loops:
//   - alias:  ONLY the short alias prefix (bmok-ocg/model)
//   - dual:   BOTH prefixes (bmok-ocg/model AND openai-compatible-chat-<uuid>/model)
//   - canonical: ONLY the full provider-id prefix (openai-compatible-chat-<uuid>/model)
//
// Managed model aliases are stored with the RAW provider-node id as the storage
// prefix (`getProviderStoragePrefix()` returns the providerId for compatible
// providers), so a model imported via a compatible node with prefix "bmok-ocg"
// and node id "openai-compatible-chat-<uuid>" produces an alias value of
// `"openai-compatible-chat-<uuid>/gpt-4o"`. The alias-backed loop must resolve
// the display alias through the configured node prefix for the alias form.

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-catalog-9526-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "catalog-9526-test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const aliasesDb = await import("../../src/lib/db/models/aliases.ts");
const v1ModelsCatalog = await import("../../src/app/api/v1/models/catalog.ts");

const NODE_ID = "openai-compatible-chat-fe9dbe0a-c239-4a64-8434-9340c86aaa5f";
const ALIAS_ID = "bmok-ocg/gpt-4o";
const CANONICAL_ID = `${NODE_ID}/gpt-4o`;

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  v1ModelsCatalog.__resetCatalogBuilderRunsForTest();
  v1ModelsCatalog.__expireCatalogCacheForTest();
}

async function seedCompatibleNode() {
  await providersDb.createProviderNode({
    id: NODE_ID,
    type: "openai-compatible",
    name: "bmok-ocg",
    prefix: "bmok-ocg",
    baseUrl: "https://demo.example.com/v1",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
  });

  await providersDb.createProviderConnection({
    provider: NODE_ID,
    authType: "apikey",
    name: "bmok-main",
    apiKey: "sk-test",
    isActive: true,
    providerSpecificData: {
      baseUrl: "https://demo.example.com/v1",
      chatPath: "/v1/chat/completions",
      modelsPath: "/v1/models",
    },
  });
}

async function getIds(prefixParam?: string): Promise<string[]> {
  const url = prefixParam
    ? `http://localhost/api/v1/models?prefix=${prefixParam}`
    : "http://localhost/api/v1/models";
  const response = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request(url, { method: "GET" })
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  return body.data.map((item) => item.id);
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("#9526 dual mode lists BOTH the alias prefix and the canonical UUID prefix", async () => {
  await seedCompatibleNode();
  // The managed-alias store writes the RAW provider id as the storage prefix.
  await aliasesDb.setModelAlias("bmok-gpt4o", `${NODE_ID}/gpt-4o`);

  const ids = await getIds();
  assert.ok(ids.includes(ALIAS_ID), "alias prefix id must be present in dual mode");
  assert.ok(ids.includes(CANONICAL_ID), "canonical UUID id must be present in dual mode");
});

test("#9526 alias mode lists ONLY the alias prefix", async () => {
  await seedCompatibleNode();
  await aliasesDb.setModelAlias("bmok-gpt4o", `${NODE_ID}/gpt-4o`);

  const ids = await getIds("alias");
  assert.ok(ids.includes(ALIAS_ID), "alias prefix id must be present in alias mode");
  assert.equal(ids.includes(CANONICAL_ID), false, "canonical UUID id must be absent in alias mode");
});

test("#9526 canonical mode lists ONLY the canonical UUID prefix", async () => {
  await seedCompatibleNode();
  await aliasesDb.setModelAlias("bmok-gpt4o", `${NODE_ID}/gpt-4o`);

  const ids = await getIds("canonical");
  assert.equal(ids.includes(ALIAS_ID), false, "alias prefix id must be absent in canonical mode");
  assert.ok(ids.includes(CANONICAL_ID), "canonical UUID id must be present in canonical mode");
});

test("#9526 synced models on a compatible node follow the same three-way prefix semantics", async () => {
  await seedCompatibleNode();
  const modelsDb = await import("../../src/lib/db/models.ts");
  await modelsDb.replaceSyncedAvailableModelsForConnection(NODE_ID, "conn-1", [
    { id: "gpt-4o", name: "GPT-4o" },
  ]);

  const dualIds = await getIds();
  assert.ok(dualIds.includes(ALIAS_ID), "alias prefix id must be present in dual mode");
  assert.ok(dualIds.includes(CANONICAL_ID), "canonical UUID id must be present in dual mode");

  const canonicalIds = await getIds("canonical");
  assert.equal(
    canonicalIds.includes(ALIAS_ID),
    false,
    "alias prefix id must be absent in canonical mode"
  );
  assert.ok(
    canonicalIds.includes(CANONICAL_ID),
    "canonical UUID id must be present in canonical mode"
  );

  const aliasIds = await getIds("alias");
  assert.ok(aliasIds.includes(ALIAS_ID), "alias prefix id must be present in alias mode");
  assert.equal(
    aliasIds.includes(CANONICAL_ID),
    false,
    "canonical UUID id must be absent in alias mode"
  );
});
