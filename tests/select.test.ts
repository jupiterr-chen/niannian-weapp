import { describe, it, expect } from "vitest";
import { pickOptional } from "../lib/core/select";
import { normalize } from "../lib/core/normalize";
import type { RowLike } from "../lib/core/types";
import {
  REQUIRED_WORDS,
  REQUIRED_TEXTS,
  ROWS,
  EXPECTED_REQUIRED_COUNT,
  EXPECTED_ROW_COUNT,
  EXPECTED_TOTAL_CANDIDATES,
  EXPECTED_REMAINING_AFTER_DEDUP,
  EXPECTED_OPTIONAL_COUNT,
} from "./fixtures/worksheet-01";

describe("golden sample shape (PROJECT.md §8)", () => {
  it("has exactly 14 required words", () => {
    expect(REQUIRED_WORDS).toHaveLength(EXPECTED_REQUIRED_COUNT);
  });

  it("has exactly 10 rows, 3 words each, 30 candidates total", () => {
    expect(ROWS).toHaveLength(EXPECTED_ROW_COUNT);
    for (const row of ROWS) {
      expect(row.words).toHaveLength(3);
    }
    const total = ROWS.reduce((sum, row) => sum + row.words.length, 0);
    expect(total).toBe(EXPECTED_TOTAL_CANDIDATES);
  });

  it("leaves the expected candidate count per row after removing required duplicates", () => {
    const requiredSet = new Set(REQUIRED_TEXTS.map(normalize));
    const remaining = ROWS.map(
      (row) => row.words.filter((w) => !requiredSet.has(normalize(w.text))).length
    );
    expect(remaining).toEqual(EXPECTED_REMAINING_AFTER_DEDUP);
  });
});

describe("pickOptional on the golden sample", () => {
  it("returns exactly 10 words, one per row, with zero overlap with required", () => {
    const optional = pickOptional(ROWS, REQUIRED_TEXTS, new Map(), () => 0.3);
    expect(optional).toHaveLength(EXPECTED_OPTIONAL_COUNT);

    const requiredNormalized = new Set(REQUIRED_TEXTS.map(normalize));
    for (const w of optional) {
      expect(requiredNormalized.has(normalize(w.text))).toBe(false);
    }
  });

  it("picks exactly one word per row, in row order", () => {
    const optional = pickOptional(ROWS, REQUIRED_TEXTS, new Map(), () => 0.5);
    expect(optional).toHaveLength(ROWS.length);
    optional.forEach((w, i) => {
      const row = ROWS[i];
      const rowTexts = row.words.map((rw) => rw.text);
      expect(rowTexts).toContain(w.text);
    });
  });

  it("is deterministic given an injected rng", () => {
    const rngValues = [0.9, 0.1, 0.5, 0.5, 0.9, 0.1, 0.5, 0.9, 0.1, 0.5];
    let i1 = 0;
    const rng1 = () => rngValues[i1++ % rngValues.length];
    let i2 = 0;
    const rng2 = () => rngValues[i2++ % rngValues.length];

    const result1 = pickOptional(ROWS, REQUIRED_TEXTS, new Map(), rng1);
    const result2 = pickOptional(ROWS, REQUIRED_TEXTS, new Map(), rng2);

    expect(result1.map((w) => w.id)).toEqual(result2.map((w) => w.id));
  });

  it("with a fixed rng returning 0, picks the highest-base-weight (here: first, all tied) candidate deterministically per row", () => {
    // rng() 恒为 0 时，score = weight(w) + 0，全部候选 weight 相同（无 stats）=1，
    // 因此每行严格取过滤后剩余候选中的第一个（argmax 在全等分数下取遇到的第一个）。
    const optional = pickOptional(ROWS, REQUIRED_TEXTS, new Map(), () => 0);
    const requiredSet = new Set(REQUIRED_TEXTS.map(normalize));
    const expectedFirstRemaining = ROWS.map(
      (row) => row.words.filter((w) => !requiredSet.has(normalize(w.text)))[0]
    );
    expect(optional.map((w) => w.id)).toEqual(expectedFirstRemaining.map((w) => w.id));
  });
});

describe("pickOptional edge cases", () => {
  it("skips a row entirely when every word in it duplicates a required word, reducing the total count", () => {
    const rows: RowLike[] = [
      {
        char: "如",
        pinyin: "rú",
        rowIndex: 0,
        words: [
          { id: 100, text: "如果", pinyin: "rú guǒ" },
          { id: 101, text: "如果", pinyin: "rú guǒ" },
        ],
      },
      {
        char: "已",
        pinyin: "yǐ",
        rowIndex: 1,
        words: [
          { id: 102, text: "已往", pinyin: "yǐ wǎng" },
          { id: 103, text: "早已", pinyin: "zǎo yǐ" },
        ],
      },
    ];
    const required = ["如果"];

    const optional = pickOptional(rows, required, new Map(), () => 0.5);

    // 第一行全部重复必听词，应被跳过；总数应比行数少 1。
    expect(optional).toHaveLength(rows.length - 1);
    expect(optional).toHaveLength(1);
    expect(["已往", "早已"]).toContain(optional[0].text);
  });

  it("returns an empty array for an empty rows array, without throwing", () => {
    expect(() => pickOptional([], [], new Map(), () => 0.5)).not.toThrow();
    expect(pickOptional([], [], new Map(), () => 0.5)).toEqual([]);
  });

  it("compares required texts after normalization (full-width / punctuation differences don't break dedup)", () => {
    const rows: RowLike[] = [
      {
        char: "如",
        pinyin: "rú",
        rowIndex: 0,
        words: [
          { id: 200, text: "如果", pinyin: "rú guǒ" },
          { id: 201, text: "如同", pinyin: "rú tóng" },
        ],
      },
    ];
    // required 里的词带全角空格/标点，normalize 后应仍能命中「如果」。
    const required = ["如　果。"];
    const optional = pickOptional(rows, required, new Map(), () => 0.5);
    expect(optional).toHaveLength(1);
    expect(optional[0].text).toBe("如同");
  });
});
