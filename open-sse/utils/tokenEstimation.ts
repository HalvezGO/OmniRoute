/**
 * CJK-aware character/token heuristics shared by the context manager and the
 * compression statistics estimator.
 *
 * English text averages ~4 chars/token; CJK text packs ~1 token per 1-2 chars,
 * so estimating a Chinese/Japanese/Korean body at the English ratio overcounts
 * by 3-4x and can falsely trigger context compaction. ASCII stays on the cheap
 * fast path; only non-ASCII strings are sampled.
 */

export const DEFAULT_CHARS_PER_TOKEN = 4;
export const CJK_CHARS_PER_TOKEN = 2.5;

const CJK_RATIO_THRESHOLD = 0.3;
// Hangul syllables/jamo, CJK unified ideographs (+ext A), hiragana/katakana.
const CJK_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF]/;
const ASCII_ONLY_RE = /^[\x00-\x7F]*$/;
const MAX_SAMPLES = 2048;

export function isPureAscii(text: string): boolean {
  return ASCII_ONLY_RE.test(text);
}

export function charsPerTokenForText(text: string): number {
  if (text.length === 0) return DEFAULT_CHARS_PER_TOKEN;
  if (isPureAscii(text)) return DEFAULT_CHARS_PER_TOKEN;

  const stride = text.length > MAX_SAMPLES ? Math.ceil(text.length / MAX_SAMPLES) : 1;
  let cjk = 0;
  let sampled = 0;
  for (let i = 0; i < text.length; i += stride) {
    sampled++;
    if (CJK_RE.test(text[i]!)) cjk++;
  }
  return sampled > 0 && cjk / sampled > CJK_RATIO_THRESHOLD
    ? CJK_CHARS_PER_TOKEN
    : DEFAULT_CHARS_PER_TOKEN;
}

/**
 * Walk strings inside a structured value without serializing it, sampling up
 * to MAX_SAMPLES characters. This keeps the multi-MB agent-body path allocation
 * free while still detecting CJK-heavy tool output.
 */
export function charsPerTokenForValue(value: unknown): number {
  let sampled = 0;
  let cjk = 0;

  const visit = (node: unknown, depth: number): void => {
    if (sampled >= MAX_SAMPLES || depth > 12) return;
    if (typeof node === "string") {
      const stride = node.length > 512 ? Math.ceil(node.length / 512) : 1;
      for (let i = 0; i < node.length && sampled < MAX_SAMPLES; i += stride) {
        sampled++;
        if (CJK_RE.test(node[i]!)) cjk++;
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth + 1);
        if (sampled >= MAX_SAMPLES) return;
      }
      return;
    }
    if (node && typeof node === "object") {
      for (const item of Object.values(node as Record<string, unknown>)) {
        visit(item, depth + 1);
        if (sampled >= MAX_SAMPLES) return;
      }
    }
  };

  visit(value, 0);
  return sampled > 0 && cjk / sampled > CJK_RATIO_THRESHOLD
    ? CJK_CHARS_PER_TOKEN
    : DEFAULT_CHARS_PER_TOKEN;
}
