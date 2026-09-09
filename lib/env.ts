import path from "node:path";
import fs from "node:fs";

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = path.resolve(process.cwd(), str("DATA_DIR", "./data"));

const arkApiKey = str("ARK_API_KEY", "");
const volcTtsApiKey = str("VOLC_TTS_API_KEY", "");
const volcTtsSpeaker = str("VOLC_TTS_SPEAKER", "");

let vlmProvider = str("VLM_PROVIDER", "ark") as "ark" | "mock";
if (vlmProvider === "ark" && arkApiKey === "") {
  console.warn(
    "[env] 未检测到 ARK_API_KEY，视觉识别（VLM）自动降级为 mock provider。" +
      "如需使用火山方舟真实识别，请在 .env.local 中配置 ARK_API_KEY（以及 ARK_BASE_URL / ARK_MODEL）。"
  );
  vlmProvider = "mock";
}

let ttsProvider = str("TTS_PROVIDER", "volcano") as "volcano" | "mock";
if (ttsProvider === "volcano" && (volcTtsApiKey === "" || volcTtsSpeaker === "")) {
  console.warn(
    "[env] 未检测到 VOLC_TTS_API_KEY 或 VOLC_TTS_SPEAKER，语音合成（TTS）自动降级为 mock provider。" +
      "如需使用火山语音真实合成，请在 .env.local 中配置 VOLC_TTS_API_KEY 与 VOLC_TTS_SPEAKER（控制台 > 音色库）。"
  );
  ttsProvider = "mock";
}

export const env = {
  port: num("PORT", 3000),
  dataDir,

  vlmProvider,
  arkApiKey,
  arkBaseUrl: str("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
  arkModel: str("ARK_MODEL", ""),

  ttsProvider,
  volcTtsBaseUrl: str(
    "VOLC_TTS_BASE_URL",
    "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
  ),
  volcTtsApiKey,
  volcTtsResourceId: str("VOLC_TTS_RESOURCE_ID", "seed-tts-2.0"),
  volcTtsSpeaker,
  // 别名：app/api/audio/route.ts 与 app/api/session/route.ts（不在本次任务
  // 可修改范围内）里的 "voice" 概念在新接口里就是 speaker 音色 ID，没有独立
  // 存在的必要。保留这个同值别名只是为了不用去动 app/ 下的文件；SynthInput
  // 契约本身的 voice 字段没有变化，volcano.ts 内部合成实际用的是 speaker。
  volcTtsVoice: volcTtsSpeaker,
  volcTtsSampleRate: num("VOLC_TTS_SAMPLE_RATE", 24000),

  ttsRepeat: num("TTS_REPEAT", 3),
  ttsGapMs: num("TTS_GAP_MS", 1500),
  ttsSpeed: num("TTS_SPEED", 1.0),
} as const;

export const paths = {
  data: dataDir,
  images: path.join(dataDir, "images"),
  audio: path.join(dataDir, "audio"),
  db: path.join(dataDir, "app.db"),
} as const;

export function ensureDataDirs(): void {
  for (const dir of [paths.data, paths.images, paths.audio]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
