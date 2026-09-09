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

function bool01(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

const dataDir = path.resolve(process.cwd(), str("DATA_DIR", "./data"));

const arkApiKey = str("ARK_API_KEY", "");
const volcTtsAppId = str("VOLC_TTS_APP_ID", "");
const volcTtsAccessToken = str("VOLC_TTS_ACCESS_TOKEN", "");

let vlmProvider = str("VLM_PROVIDER", "ark") as "ark" | "mock";
if (vlmProvider === "ark" && arkApiKey === "") {
  console.warn(
    "[env] 未检测到 ARK_API_KEY，视觉识别（VLM）自动降级为 mock provider。" +
      "如需使用火山方舟真实识别，请在 .env.local 中配置 ARK_API_KEY（以及 ARK_BASE_URL / ARK_MODEL）。"
  );
  vlmProvider = "mock";
}

let ttsProvider = str("TTS_PROVIDER", "volcano") as "volcano" | "mock";
if (ttsProvider === "volcano" && (volcTtsAppId === "" || volcTtsAccessToken === "")) {
  console.warn(
    "[env] 未检测到 VOLC_TTS_APP_ID 或 VOLC_TTS_ACCESS_TOKEN，语音合成（TTS）自动降级为 mock provider。" +
      "如需使用火山语音真实合成，请在 .env.local 中配置 VOLC_TTS_APP_ID 与 VOLC_TTS_ACCESS_TOKEN（以及 VOLC_TTS_CLUSTER / VOLC_TTS_VOICE）。"
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
  volcTtsBaseUrl: str("VOLC_TTS_BASE_URL", "https://openspeech.bytedance.com/api/v1/tts"),
  volcTtsAppId,
  volcTtsAccessToken,
  volcTtsCluster: str("VOLC_TTS_CLUSTER", "volcano_tts"),
  volcTtsVoice: str("VOLC_TTS_VOICE", ""),
  volcTtsSsml: bool01("VOLC_TTS_SSML", true),

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
