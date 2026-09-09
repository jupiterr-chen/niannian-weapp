import { createHash } from "node:crypto";

export interface AudioCacheKeyInput {
  ttsText: string;
  pinyin: string;
  voice: string;
  speed: number;
  repeat: number;
  gapMs: number;
  // 「第 N 个」的 N；试听时不报序号，传 undefined 即得到空串。
  seqLabel?: number | string;
}

// §4.5：md5(ttsText + '|' + pinyin + '|' + voice + '|' + speed + '|' + repeat + '|' + gapMs + '|' + seqLabel)
export function audioCacheKey(input: AudioCacheKeyInput): string {
  const seqLabel =
    input.seqLabel === undefined || input.seqLabel === null ? "" : String(input.seqLabel);
  const raw = [
    input.ttsText,
    input.pinyin,
    input.voice,
    String(input.speed),
    String(input.repeat),
    String(input.gapMs),
    seqLabel,
  ].join("|");
  return createHash("md5").update(raw, "utf8").digest("hex");
}
