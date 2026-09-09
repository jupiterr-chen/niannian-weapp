import type { WordLike } from "./types";

export type Bucket = "required" | "optional";

export type OrderedWord = WordLike & {
  seq: number;
  bucket: Bucket;
};

// §4.3：[...required, ...optional]。两组内部保持输入原序，不打乱。seq 从 1 开始连续编号。
export function buildOrder(required: WordLike[], optional: WordLike[]): OrderedWord[] {
  const ordered: OrderedWord[] = [];
  let seq = 1;

  for (const w of required) {
    ordered.push({ ...w, seq, bucket: "required" });
    seq += 1;
  }
  for (const w of optional) {
    ordered.push({ ...w, seq, bucket: "optional" });
    seq += 1;
  }

  return ordered;
}
