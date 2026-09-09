// D-9：mock TTS 不返回静音。手写一段 16bit PCM / 16kHz 单声道 WAV，用
// 正弦提示音模拟「（报序号）+ 词 * repeat，遍间留白 gapMs」的真实节奏，
// 这样没有任何云端密钥时，也能在浏览器里听出三遍 + 1.5 秒间隔的完整时序，
// 用来验证前端播放时序、防叠音、预取这些和真实语音内容无关的逻辑。
//
// WAV 头封装与静音 PCM 生成复用 lib/tts/wav.ts——volcano.ts 的真实装配走的
// 是同一份工具，避免两处各写一份 44 字节头。
import { planSegments, type SynthInput, type SynthOutput, type TtsProvider } from "./index";
import { encodeWav, silencePcm } from "./wav";

const SAMPLE_RATE = 16000;
const WORD_TONE_HZ = 880; // 词本身的提示音
const WORD_TONE_MS = 400;
const LABEL_TONE_HZ = 1320; // 「第 N 个」占位音，音高不同便于分辨
const LABEL_TONE_MS = 200;
const AMPLITUDE = 0.3 * 32767; // 留足 headroom，避免削波
const FADE_SEC = 0.005; // 5ms 淡入淡出，避免每段提示音首尾出现爆音

function sineSamples(freqHz: number, durationMs: number): Buffer {
  const n = Math.max(1, Math.round((durationMs / 1000) * SAMPLE_RATE));
  const buf = Buffer.alloc(n * 2);
  const fadeSamples = Math.min(Math.round(FADE_SEC * SAMPLE_RATE), Math.floor(n / 2));
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (fadeSamples > 0) {
      if (i < fadeSamples) env = i / fadeSamples;
      else if (i > n - fadeSamples) env = (n - i) / fadeSamples;
    }
    const t = i / SAMPLE_RATE;
    const sample = Math.round(AMPLITUDE * env * Math.sin(2 * Math.PI * freqHz * t));
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

export class MockTtsProvider implements TtsProvider {
  readonly name = "mock";

  async synthesize(input: SynthInput): Promise<SynthOutput> {
    const segments = planSegments(input);
    const gapMs = Math.max(0, Math.floor(input.gapMs));
    const chunks: Buffer[] = [];
    segments.forEach((seg, i) => {
      chunks.push(
        seg.kind === "label" ? sineSamples(LABEL_TONE_HZ, LABEL_TONE_MS) : sineSamples(WORD_TONE_HZ, WORD_TONE_MS)
      );
      if (i < segments.length - 1) chunks.push(silencePcm(gapMs, SAMPLE_RATE));
    });
    const pcm = Buffer.concat(chunks);
    return { audio: encodeWav(pcm, { sampleRate: SAMPLE_RATE }), mime: "audio/wav" };
  }
}
