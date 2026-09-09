import type { MistakeStat } from "./types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// §4.4：
// 1
// + 2.0 * min(skip_count, 3)
// + 1.0 * min(hint_sum, 4)
// + 1.5 * (last_bad 在 7 天内 ? 1 : 0)
// - 3.0 * (graduated ? 1 : 0)
// stats 为空时全部退化为 1。
export function weight(
  wordId: number,
  stats: Map<number, MistakeStat> | Record<number, MistakeStat>,
  now: number = Date.now()
): number {
  const stat = stats instanceof Map ? stats.get(wordId) : stats[wordId];
  if (!stat) return 1;

  const skipTerm = 2.0 * Math.min(stat.skipCount, 3);
  const hintTerm = 1.0 * Math.min(stat.hintSum, 4);
  const recentBad =
    stat.lastBad !== null && now - new Date(stat.lastBad).getTime() <= SEVEN_DAYS_MS;
  const recentTerm = 1.5 * (recentBad ? 1 : 0);
  const graduatedTerm = 3.0 * (stat.graduated ? 1 : 0);

  return 1 + skipTerm + hintTerm + recentTerm - graduatedTerm;
}
