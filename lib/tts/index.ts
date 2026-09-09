// TTS provider 契约。PROJECT.md §10.5/§10.6 覆盖了 §5.2 的全部内容：上一代
// SSML 注音已作废，火山改用「发音词典 + 分件 PCM 装配」。这个文件只保留对
// app/api 路由稳定的公共接口（D-8 的 { audio, mime } 返回形状不变），内部
// 装配细节在 volcano.ts / mock.ts 里各自实现。

import { env } from "../env";
import { VolcanoTtsProvider } from "./volcano";
import { MockTtsProvider } from "./mock";

export interface SynthInput {
  text: string; // 实际送去合成的文本（已应用 tts_text 覆盖）
  pinyin: string;
  voice: string;
  speed: number; // 0.8 | 1.0
  repeat: number; // 3（听写）| 1（试听、再读一遍）
  gapMs: number; // 1500
  seqLabel?: number; // 有值则在最前面加「第 N 个」整段
}

export interface SynthOutput {
  audio: Buffer;
  mime: string;
  // D-11：true 表示这段音频不可信，不能进持久缓存。触发条件见 volcano.ts：
  // 词因超过 9 字符/含空格/拼音音节数对不齐而无法进发音词典。
  degraded?: boolean;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(input: SynthInput): Promise<SynthOutput>;
}

// §10.6 音频装配的公共骨架：有值就先放「第 N 个」整段，再把词放 repeat 遍，
// 段与段之间留一个间隔位置（由调用方决定间隔怎么生成——volcano.ts 用
// silencePcm 生成真静音 PCM，mock.ts 用同一份函数）。mock.ts 和 volcano.ts
// 都需要这套顺序，共享它以避免两处在 repeat/seqLabel 语义上各写一套、逐渐
// 跑偏。
export type TtsSegment = { kind: "label" } | { kind: "word" };

export function planSegments(input: SynthInput): TtsSegment[] {
  const segments: TtsSegment[] = [];
  if (input.seqLabel !== undefined) segments.push({ kind: "label" });
  const repeat = Math.max(1, Math.floor(input.repeat));
  for (let i = 0; i < repeat; i++) segments.push({ kind: "word" });
  return segments;
}

export function getTtsProvider(): TtsProvider {
  return env.ttsProvider === "volcano" ? new VolcanoTtsProvider() : new MockTtsProvider();
}
