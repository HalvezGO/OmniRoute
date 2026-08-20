/**
 * Regression guard for the client-visible `usage` allowlist in
 * `filterUsageForFormat()` (open-sse/utils/usageTracking.ts).
 *
 * The usage block returned to callers is NOT a passthrough of the upstream usage —
 * it is selectively filtered against a per-format allowlist. This suite locks down:
 *
 *   1. #8171 rebuild: flat `cached_tokens` / `cache_read_input_tokens` from the
 *      upstream usage are folded into `prompt_tokens_details.cached_tokens` so an
 *      OpenAI-shaped client gets the cache-read numbers even from providers that
 *      only report them flat (Bedrock / Claude-style flat fields).
 *   2. OpenAI allowlist keeps the flat cache fields
 *      (`prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`,
 *      `cache_read_input_tokens`, `cache_creation_input_tokens`) — dropping them
 *      was why "Cache Read" showed N/A for Bedrock-style upstreams.
 *   3. Claude allowlist keeps `output_tokens_details`.
 *   4. Responses allowlist keeps `total_tokens`, `cost_in_usd_ticks` and the
 *      server-side tool usage details (xAI agent tools).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { filterUsageForFormat } from "../../open-sse/utils/usageTracking.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";

test("filterUsageForFormat(OpenAI) rebuilds flat cached_tokens into prompt_tokens_details.cached_tokens (#8171)", () => {
  const filtered = filterUsageForFormat(
    {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      cached_tokens: 7,
    },
    FORMATS.OPENAI
  ) as Record<string, unknown>;

  assert.equal(filtered.prompt_tokens, 100);
  assert.equal(filtered.cached_tokens, 7, "flat cached_tokens must stay in the OpenAI allowlist");
  assert.deepEqual(
    filtered.prompt_tokens_details,
    { cached_tokens: 7 },
    "flat cached_tokens must also be rebuilt into prompt_tokens_details.cached_tokens"
  );
});

test("filterUsageForFormat(OpenAI) rebuilds flat cache_read_input_tokens into details when cached_tokens absent", () => {
  const filtered = filterUsageForFormat(
    {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      cache_read_input_tokens: 12_345,
    },
    FORMATS.OPENAI
  ) as Record<string, unknown>;

  assert.equal(filtered.cache_read_input_tokens, 12_345, "flat cache_read must survive allowlist");
  assert.deepEqual(
    filtered.prompt_tokens_details,
    { cached_tokens: 12_345 },
    "cache_read_input_tokens must be rebuilt into prompt_tokens_details.cached_tokens"
  );
});

test("filterUsageForFormat(OpenAI) prefers existing nested cached_tokens over flat fallback", () => {
  const filtered = filterUsageForFormat(
    {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      cached_tokens: 7,
      prompt_tokens_details: { cached_tokens: 99, image_tokens: 3 },
    },
    FORMATS.OPENAI
  ) as Record<string, unknown>;

  assert.deepEqual(
    filtered.prompt_tokens_details,
    { cached_tokens: 99, image_tokens: 3 },
    "an existing nested cached_tokens must win over the flat fallback"
  );
});

test("filterUsageForFormat(OpenAI) keeps DeepSeek flat prompt_cache_hit/miss fields", () => {
  const filtered = filterUsageForFormat(
    {
      prompt_tokens: 4364,
      completion_tokens: 27,
      total_tokens: 4391,
      prompt_cache_hit_tokens: 4352,
      prompt_cache_miss_tokens: 12,
    },
    FORMATS.OPENAI
  ) as Record<string, unknown>;

  assert.equal(filtered.prompt_cache_hit_tokens, 4352);
  assert.equal(filtered.prompt_cache_miss_tokens, 12);
});

test("filterUsageForFormat(OpenAI) keeps cache_read/cache_creation flat fields (Bedrock-style)", () => {
  const filtered = filterUsageForFormat(
    {
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 900,
    },
    FORMATS.OPENAI
  ) as Record<string, unknown>;

  assert.equal(filtered.cache_read_input_tokens, 800);
  assert.equal(filtered.cache_creation_input_tokens, 900);
});

test("filterUsageForFormat(OpenAI) still strips non-allowlisted fields", () => {
  const filtered = filterUsageForFormat(
    {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      provider_only_debug: true,
      cost_in_usd_ticks: 999,
    },
    FORMATS.OPENAI
  ) as Record<string, unknown>;

  assert.equal(Object.hasOwn(filtered, "provider_only_debug"), false);
  assert.equal(Object.hasOwn(filtered, "cost_in_usd_ticks"), false);
});

test("filterUsageForFormat(Claude) keeps output_tokens_details", () => {
  const filtered = filterUsageForFormat(
    {
      input_tokens: 100,
      output_tokens: 20,
      output_tokens_details: { reasoning_tokens: 2 },
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 40,
    },
    FORMATS.CLAUDE
  ) as Record<string, unknown>;

  assert.equal(filtered.input_tokens, 100);
  assert.equal(filtered.output_tokens, 20);
  assert.deepEqual(filtered.output_tokens_details, { reasoning_tokens: 2 });
  assert.equal(filtered.cache_read_input_tokens, 30);
  assert.equal(filtered.cache_creation_input_tokens, 40);
});

test("filterUsageForFormat(openai-responses) keeps total_tokens + cost ticks + server-side tool usage", () => {
  const filtered = filterUsageForFormat(
    {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      cost_in_usd_ticks: 154733500,
      server_side_tool_usage_details: { web_search_calls: 1, x_search_calls: 0 },
      server_side_tool_usage: { web_search: 1 },
      x_groq: { should_not: "survive" },
    },
    FORMATS.OPENAI_RESPONSES
  ) as Record<string, unknown>;

  assert.equal(filtered.total_tokens, 15);
  assert.equal(filtered.cost_in_usd_ticks, 154733500);
  assert.deepEqual(filtered.server_side_tool_usage_details, {
    web_search_calls: 1,
    x_search_calls: 0,
  });
  assert.deepEqual(filtered.server_side_tool_usage, { web_search: 1 });
  assert.equal(filtered.x_groq, undefined, "non-allowlisted fields must be stripped");
});
