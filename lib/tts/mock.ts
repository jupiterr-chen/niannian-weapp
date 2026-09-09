// D-9：mock TTS 不返回静音。手写一段 16bit PCM / 16kHz 单声道 WAV，用
// 正弦提示音模拟「（报序号）+ 词 * repeat，遍间留白 gapMs」的真实节奏，
// 这样没有任何云端密钥时，也能在浏览器里听出三遍 + 1.5 秒间隔的完整时序，
// 用来验证前端播放时序、防叠音、预取这些和真实语音内容无关的逻辑。
import { planSegments, type SynthInput, type SynthOutput, type TtsProvider } from "./index";

const SAMPLE_RATE = 16000;
const WORD_TONE_HZ = 880; // 词本身的提示音
const WORD_TONE_MS = 400;
const LABEL_TONE_HZ = 1320; // 「第 N 个」占位音，音高不同便于分辨
const LABEL_TONE_MS = 200;
const AMPLITUDE = 0.3 * 32767; // 留足 headroom，避免削波
const FADE_SEC = 0.005; // 5ms 淡入淡出，避免每段提示音首尾出现爆音

function sineSamples(freqHz: number, durationMs: number): Int16Array {
  const n = Math.max(1, Math.round((durationMs / 1000) * SAMPLE_RATE));
  const samples = new Int16Array(n);
  const fadeSamples = Math.min(Math.round(FADE_SEC * SAMPLE_RATE), Math.floor(n / 2));
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (fadeSamples > 0) {
      if (i < fadeSamples) env = i / fadeSamples;
      else if (i > n - fadeSamples) env = (n - i) / fadeSamples;
    }
    const t = i / SAMPLE_RATE;
    samples[i] = Math.round(AMPLITUDE * env * Math.sin(2 * Math.PI * freqHz * t));
  }
  return samples;
}

function silenceSamples(durationMs: number): Int16Array {
  const n = Math.max(0, Math.round((durationMs / 1000) * SAMPLE_RATE));
  return new Int16Array(n);
}

function encodeWav(chunks: Int16Array[]): Buffer {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const dataSize = totalSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate = sampleRate * blockAlign
  buffer.writeUInt16LE(2, 32); // block align = channels * bytesPerSample
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      buffer.writeInt16LE(chunk[i], offset);
      offset += 2;
    }
  }
  return buffer;
}

export class MockTtsProvider implements TtsProvider {
  readonly name = "mock";

  async synthesize(input: SynthInput): Promise<SynthOutput> {
    const segments = planSegments(input);
    const gapMs = Math.max(0, Math.floor(input.gapMs));
    const chunks: Int16Array[] = [];
    segments.forEach((seg, i) => {
      chunks.push(
        seg.kind === "label" ? sineSamples(LABEL_TONE_HZ, LABEL_TONE_MS) : sineSamples(WORD_TONE_HZ, WORD_TONE_MS)
      );
      if (i < segments.length - 1) chunks.push(silenceSamples(gapMs));
    });
    return { audio: encodeWav(chunks), mime: "audio/wav" };
  }
}
