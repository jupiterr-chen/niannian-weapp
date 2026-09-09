import { describe, it, expect } from "vitest";
import { audioCacheKey, type AudioCacheKeyInput } from "../lib/core/cachekey";

function baseInput(overrides: Partial<AudioCacheKeyInput> = {}): AudioCacheKeyInput {
  return {
    ttsText: "长大",
    pinyin: "zhǎng dà",
    voice: "voice-1",
    speed: 1.0,
    repeat: 3,
    gapMs: 1500,
    seqLabel: 5,
    ...overrides,
  };
}

describe("audioCacheKey", () => {
  it("is deterministic for identical input", () => {
    const a = audioCacheKey(baseInput());
    const b = audioCacheKey(baseInput());
    expect(a).toBe(b);
  });

  it("produces a 32-character hex md5 digest", () => {
    const key = audioCacheKey(baseInput());
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("differs when the same word has a different pinyin (multi-pinyin disambiguation)", () => {
    const zhangda = audioCacheKey(baseInput({ ttsText: "长大", pinyin: "zhǎng dà" }));
    const changda = audioCacheKey(baseInput({ ttsText: "长大", pinyin: "cháng dà" }));
    expect(zhangda).not.toBe(changda);
  });

  it("differs when repeat differs (3 遍 vs 1 遍)", () => {
    const repeat3 = audioCacheKey(baseInput({ repeat: 3 }));
    const repeat1 = audioCacheKey(baseInput({ repeat: 1 }));
    expect(repeat3).not.toBe(repeat1);
  });

  it("differs when voice, speed, gapMs, or seqLabel differ", () => {
    const base = audioCacheKey(baseInput());
    expect(audioCacheKey(baseInput({ voice: "voice-2" }))).not.toBe(base);
    expect(audioCacheKey(baseInput({ speed: 0.8 }))).not.toBe(base);
    expect(audioCacheKey(baseInput({ gapMs: 2000 }))).not.toBe(base);
    expect(audioCacheKey(baseInput({ seqLabel: 6 }))).not.toBe(base);
  });

  it("treats a missing seqLabel as an empty string (试听场景)", () => {
    const withoutSeq = audioCacheKey(baseInput({ seqLabel: undefined }));
    const withEmptyString = audioCacheKey(baseInput({ seqLabel: "" }));
    expect(withoutSeq).toBe(withEmptyString);
  });
});
