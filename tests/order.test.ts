import { describe, it, expect } from "vitest";
import { buildOrder } from "../lib/core/order";
import type { WordLike } from "../lib/core/types";
import { REQUIRED_WORDS, ROWS, EXPECTED_TOTAL_DICTATION_COUNT } from "./fixtures/worksheet-01";
import { pickOptional } from "../lib/core/select";
import { REQUIRED_TEXTS } from "./fixtures/worksheet-01";

describe("buildOrder", () => {
  it("concatenates required then optional, preserving each group's original order", () => {
    const required: WordLike[] = [
      { id: 1, text: "a", pinyin: "a" },
      { id: 2, text: "b", pinyin: "b" },
    ];
    const optional: WordLike[] = [
      { id: 3, text: "c", pinyin: "c" },
      { id: 4, text: "d", pinyin: "d" },
    ];
    const ordered = buildOrder(required, optional);

    expect(ordered.map((w) => w.text)).toEqual(["a", "b", "c", "d"]);
    expect(ordered.map((w) => w.seq)).toEqual([1, 2, 3, 4]);
    expect(ordered.map((w) => w.bucket)).toEqual([
      "required",
      "required",
      "optional",
      "optional",
    ]);
  });

  it("returns an empty array when both inputs are empty", () => {
    expect(buildOrder([], [])).toEqual([]);
  });

  it("golden sample: 24 total, seq 1-14 required, seq 15-24 optional, groups keep input order", () => {
    const optional = pickOptional(ROWS, REQUIRED_TEXTS, new Map(), () => 0.25);
    const ordered = buildOrder(REQUIRED_WORDS, optional);

    expect(ordered).toHaveLength(EXPECTED_TOTAL_DICTATION_COUNT);

    const requiredPart = ordered.slice(0, 14);
    const optionalPart = ordered.slice(14);

    expect(requiredPart.every((w) => w.bucket === "required")).toBe(true);
    expect(optionalPart.every((w) => w.bucket === "optional")).toBe(true);
    expect(requiredPart.map((w) => w.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(optionalPart.map((w) => w.seq)).toEqual([
      15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);

    expect(requiredPart.map((w) => w.text)).toEqual(REQUIRED_WORDS.map((w) => w.text));
    expect(optionalPart.map((w) => w.text)).toEqual(optional.map((w) => w.text));
  });
});
