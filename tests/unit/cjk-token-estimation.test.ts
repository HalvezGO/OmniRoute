/**
 * CJK text packs ~1 token per 1-2 characters, not 4. Estimating Chinese,
 * Japanese or Korean bodies at the English ratio overcounts by 3-4x and can
 * falsely trigger context compaction. These tests pin the shared heuristic and
 * both call sites (context manager + compression stats).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  charsPerTokenForText,
  charsPerTokenForValue,
} from "../../open-sse/utils/tokenEstimation.ts";
import { estimateTokens } from "../../open-sse/services/contextManager.ts";
import { estimateCompressionTokens } from "../../open-sse/services/compression/stats.ts";

test("pure ASCII keeps the 4 chars/token fast path", () => {
  assert.equal(charsPerTokenForText("hello world"), 4);
  assert.equal(charsPerTokenForValue({ text: "hello world" }), 4);
});

test("CJK-heavy text uses the 2.5 chars/token ratio", () => {
  assert.equal(charsPerTokenForText("你好世界，这是一段中文文本。"), 2.5);
  assert.equal(charsPerTokenForValue({ text: "你好世界，这是一段中文文本。" }), 2.5);
  assert.equal(charsPerTokenForText("こんにちは世界"), 2.5);
  assert.equal(charsPerTokenForText("안녕하세요 세계"), 2.5);
});

test("mostly-ASCII mixed text stays on the English ratio", () => {
  assert.equal(charsPerTokenForText("hello 你好 world, this is mostly ASCII"), 4);
});

test("context manager estimates CJK strings and objects more tightly", () => {
  const cjk = "你好世界";
  assert.equal(estimateTokens(cjk), Math.ceil(cjk.length / 2.5));
  assert.equal(estimateTokens("hello"), Math.ceil("hello".length / 4));
  assert.ok(estimateTokens({ text: cjk }) > 0);
});

test("compression stats uses the same CJK ratio", () => {
  const cjk = "你好世界";
  assert.equal(estimateCompressionTokens(cjk), Math.ceil(cjk.length / 2.5));
  assert.equal(estimateCompressionTokens("hello"), Math.ceil("hello".length / 4));
});
