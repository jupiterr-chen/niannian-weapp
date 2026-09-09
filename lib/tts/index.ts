// §5.2 TTS provider 契约。D-8：返回类型改为 { audio, mime }（而非裸 Buffer），
// 因为 mock provider 生成 WAV 比伪造合法 MP3 可靠得多，API 路由据 mime 设置
// Content-Type。

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
  seqLabel?: number; // 有值则在最前面加「第 N 个。」
}

export interface SynthOutput {
  audio: Buffer;
  mime: string;
  // D-11：true 表示这不是按 pinyin 强制注音得到的结果（SSML 被业务拒绝后
  // 回落纯文本），读音可能不准。调用方（尤其是 lib/tts/cache.ts）绝不能把
  // degraded 的音频写进持久缓存，否则一个读错的多音字会永久固化下去。
  degraded?: boolean;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(input: SynthInput): Promise<SynthOutput>;
}

// 文本/音频组装的公共骨架：volcano.ts（纯文本兜底与 SSML）和 mock.ts（提示音）
// 都需要「有值就先报序号，然后把词念 repeat 遍，遍间留白」这套顺序，只是各自
// 用不同媒介（文字 vs. 正弦波）去实现每一段。共享这层顺序，避免两处各写一套
// 容易在 repeat/seqLabel 语义上跑偏。
export type TtsSegment = { kind: "label" } | { kind: "word" };

export function planSegments(input: SynthInput): TtsSegment[] {
  const segments: TtsSegment[] = [];
  if (input.seqLabel !== undefined) segments.push({ kind: "label" });
  const repeat = Math.max(1, Math.floor(input.repeat));
  for (let i = 0; i < repeat; i++) segments.push({ kind: "word" });
  return segments;
}

// 纯文本合成用：无法像 SSML 那样用 <break> 精确控制停顿时长，只能用句号占位，
// 依赖 provider 自身在句末的自然停顿（§5.3 第 2 层文档原话）。
export function buildPlainText(input: SynthInput): string {
  const segments = planSegments(input);
  const parts = segments.map((seg) =>
    seg.kind === "label" ? `第${input.seqLabel}个` : input.text
  );
  return `${parts.join("。")}。`;
}

export function getTtsProvider(): TtsProvider {
  return env.ttsProvider === "volcano" ? new VolcanoTtsProvider() : new MockTtsProvider();
}
