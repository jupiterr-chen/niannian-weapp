// 共用的 44 字节标准 WAV 头封装 + 静音 PCM 生成。
//
// 为什么要抽出来：mock.ts（本地提示音）和 volcano.ts（§10.6 音频装配，把
// 火山返回的 PCM 分片按 [第N个][静音][词][静音][词][静音][词] 拼好后套头）
// 都需要往一段裸 PCM 数据前面写同一份 WAV 头。写两份等于给同一个格式维护
// 两处随时可能长歪的实现，所以统一到这一个文件。
//
// 假设：16bit 有符号小端、单声道 PCM。这是本项目目前唯一用到的格式
// （§10.5 请求体里 audio_params.format 恒为 "pcm"，位深/声道由火山文档默认
// 值推断），真实密钥可用后需要用 scripts/tts-smoke.ts 里的装配校验环节确认
// 一次。

export interface WavEncodeOptions {
  sampleRate: number;
  channels?: number; // 默认单声道
  bitsPerSample?: number; // 默认 16bit
}

export function encodeWav(pcm: Buffer, options: WavEncodeOptions): Buffer {
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const sampleRate = options.sampleRate;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

// 全 0 字节即代表静音（有符号 PCM 的零点在数值 0），不需要额外计算。
// §10.6：静音时长 = gapMs/1000 * sampleRate * 2 字节（16bit 单声道）。
export function silencePcm(
  durationMs: number,
  sampleRate: number,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  const bytesPerSample = bitsPerSample / 8;
  const n = Math.max(0, Math.round((durationMs / 1000) * sampleRate));
  return Buffer.alloc(n * channels * bytesPerSample);
}

// 供 scripts/tts-smoke.ts 装配校验使用：从一段完整 WAV 里读回关键字段并算出
// 时长，不依赖任何第三方音频库。假设文件就是本文件 encodeWav() 写出来的
// 标准 44 字节头 + 紧随其后的 data（没有额外的 chunk），这对我们自己产出的
// 文件总是成立。
export interface WavInfo {
  valid: boolean;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataSize: number;
  durationSec: number;
}

export function readWavInfo(buf: Buffer): WavInfo {
  const invalid: WavInfo = {
    valid: false,
    sampleRate: 0,
    channels: 0,
    bitsPerSample: 0,
    dataSize: 0,
    durationSec: 0,
  };
  if (buf.length < 44) return invalid;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return invalid;
  if (buf.toString("ascii", 8, 12) !== "WAVE") return invalid;
  if (buf.toString("ascii", 12, 16) !== "fmt ") return invalid;
  if (buf.toString("ascii", 36, 40) !== "data") return invalid;

  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const dataSize = buf.readUInt32LE(40);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const durationSec = byteRate > 0 ? dataSize / byteRate : 0;

  return { valid: true, sampleRate, channels, bitsPerSample, dataSize, durationSec };
}
