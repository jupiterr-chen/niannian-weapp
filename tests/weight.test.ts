import { describe, it, expect } from "vitest";
import { weight } from "../lib/core/weight";
import type { MistakeStat } from "../lib/core/types";

const NOW = new Date("2026-09-09T00:00:00Z").getTime();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function stat(overrides: Partial<MistakeStat> = {}): MistakeStat {
  return {
    skipCount: 0,
    hintSum: 0,
    lastBad: null,
    graduated: false,
    ...overrides,
  };
}

describe("weight", () => {
  it("returns 1 when the word has no stats at all", () => {
    const stats = new Map<number, MistakeStat>();
    expect(weight(1, stats, NOW)).toBe(1);
  });

  it("applies the base formula: 1 + 2*min(skip,3) + 1*min(hint,4) + 1.5*recentBad - 3*graduated", () => {
    const stats = new Map<number, MistakeStat>([
      [
        1,
        stat({
          skipCount: 2,
          hintSum: 3,
          lastBad: new Date(NOW - ONE_DAY_MS).toISOString(),
          graduated: false,
        }),
      ],
    ]);
    // 1 + 2*2 + 1*3 + 1.5*1 - 0 = 1 + 4 + 3 + 1.5 = 9.5
    expect(weight(1, stats, NOW)).toBeCloseTo(9.5);
  });

  it("caps skipCount contribution at 3 (a 4th skip does not add further weight)", () => {
    const stats3 = new Map<number, MistakeStat>([[1, stat({ skipCount: 3 })]]);
    const stats4 = new Map<number, MistakeStat>([[1, stat({ skipCount: 4 })]]);
    expect(weight(1, stats3, NOW)).toBe(weight(1, stats4, NOW));
    expect(weight(1, stats3, NOW)).toBe(1 + 2 * 3);
  });

  it("caps hintSum contribution at 4", () => {
    const stats4 = new Map<number, MistakeStat>([[1, stat({ hintSum: 4 })]]);
    const stats5 = new Map<number, MistakeStat>([[1, stat({ hintSum: 5 })]]);
    expect(weight(1, stats4, NOW)).toBe(weight(1, stats5, NOW));
  });

  it("ignores lastBad older than 7 days", () => {
    const eightDaysAgo = new Date(NOW - 8 * ONE_DAY_MS).toISOString();
    const stats = new Map<number, MistakeStat>([[1, stat({ lastBad: eightDaysAgo })]]);
    expect(weight(1, stats, NOW)).toBe(1);
  });

  it("counts lastBad exactly within 7 days", () => {
    const sixDaysAgo = new Date(NOW - 6 * ONE_DAY_MS).toISOString();
    const stats = new Map<number, MistakeStat>([[1, stat({ lastBad: sixDaysAgo })]]);
    expect(weight(1, stats, NOW)).toBe(1 + 1.5);
  });

  it("graduated reduces weight by 3, and repeated success (no skip, no hint) lets it apply", () => {
    // 连续两次「不跳过零提示」后 graduated 生效使权重下降：模拟 graduated=true 且
    // 本次没有新的 skip/hint 记录，权重应明显低于未毕业、有不良记录的同词。
    const graduatedStats = new Map<number, MistakeStat>([
      [1, stat({ skipCount: 0, hintSum: 0, graduated: true })],
    ]);
    const notGraduatedStats = new Map<number, MistakeStat>([
      [1, stat({ skipCount: 0, hintSum: 0, graduated: false })],
    ]);
    expect(weight(1, graduatedStats, NOW)).toBe(1 - 3);
    expect(weight(1, graduatedStats, NOW)).toBeLessThan(weight(1, notGraduatedStats, NOW));
  });

  it("supports a plain Record in addition to a Map", () => {
    const stats: Record<number, MistakeStat> = { 1: stat({ skipCount: 1 }) };
    expect(weight(1, stats, NOW)).toBe(1 + 2);
  });
});
