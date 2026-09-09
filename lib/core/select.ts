import type { RowLike, WordLike, MistakeStat } from "./types";
import { normalize } from "./normalize";
import { weight } from "./weight";

// §4.2：
// 对 rows 按原始行序遍历（不打乱）：
//   cands = row.words 中 normalize(text) 不在 required 集合里的
//   若 cands 为空 → 跳过该行
//   否则 push argmax(cands, w => weight(w, stats) + random()*0.5)
// 返回 picked   // 每行恰好 1 个，数量 = 有效行数
export function pickOptional(
  rows: RowLike[],
  requiredTexts: string[],
  stats: Map<number, MistakeStat> | Record<number, MistakeStat> = new Map(),
  rng: () => number = Math.random
): WordLike[] {
  const requiredSet = new Set(requiredTexts.map(normalize));
  const picked: WordLike[] = [];

  for (const row of rows) {
    const cands = row.words.filter((w) => !requiredSet.has(normalize(w.text)));
    if (cands.length === 0) continue;

    let best = cands[0];
    let bestScore = -Infinity;
    for (const w of cands) {
      const wordId = w.id ?? -1; // 无 id 的词永远查不到 stats，退化为权重 1
      const score = weight(wordId, stats) + rng() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
    picked.push(best);
  }

  return picked;
}
