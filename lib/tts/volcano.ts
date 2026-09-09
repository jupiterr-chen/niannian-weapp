// §5.2 / §5.3：火山引擎语音合成 provider。所有 URL、字段名、cluster、voice
// 均来自 env，出了接口形状偏差不用改代码，改 .env.local 即可。
import { randomUUID } from "node:crypto";
import { env } from "../env";
import { buildPlainText, planSegments, type SynthInput, type SynthOutput, type TtsProvider } from "./index";

interface VolcanoTtsResponse {
  code: number;
  data?: string;
  message?: string;
}

const RETRY_DELAYS_MS = [500, 1500]; // §5.4：非业务错误重试 2 次，指数退避
const REQUEST_TIMEOUT_MS = 15000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 火山返回 code !== 3000 属于业务错误（鉴权失败、参数错误等），不应重试；
// 网络异常/超时/5xx 属于瞬时故障，值得重试。用专门的错误类型区分两者，
// 避免在 catch 块里用字符串猜测错误来源。
class VolcanoBusinessError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "VolcanoBusinessError";
  }
}

async function postJsonOnce(
  url: string,
  payload: unknown,
  headers: Record<string, string>
): Promise<VolcanoTtsResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500) {
    // 5xx 视为瞬时故障，交给上层重试。
    throw new Error(`火山 TTS HTTP ${res.status}`);
  }
  const json = (await res.json()) as VolcanoTtsResponse;
  return json;
}

// 网络异常 / 超时 / 5xx 重试 2 次（500ms、1500ms 指数退避）。业务错误码
// （HTTP 200 但 code !== 3000）不在这里重试，由调用方决定是否走三层防线的
// 下一层。
async function postWithRetry(
  url: string,
  payload: unknown,
  headers: Record<string, string>
): Promise<VolcanoTtsResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await postJsonOnce(url, payload, headers);
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// 声调符号 -> 数字声调，用于拼出火山 <phoneme alphabet="py"> 需要的数字声调
// 拼音（如 zhǎng -> zhang3）。ü 系列在数字声调写法里约定用 v 代替（避免和 u
// 混淆），轻声（无声调符号）记 5。
const TONE_MAP: Record<string, [string, number]> = {
  ā: ["a", 1], á: ["a", 2], ǎ: ["a", 3], à: ["a", 4],
  ē: ["e", 1], é: ["e", 2], ě: ["e", 3], è: ["e", 4],
  ī: ["i", 1], í: ["i", 2], ǐ: ["i", 3], ì: ["i", 4],
  ō: ["o", 1], ó: ["o", 2], ǒ: ["o", 3], ò: ["o", 4],
  ū: ["u", 1], ú: ["u", 2], ǔ: ["u", 3], ù: ["u", 4],
  ǖ: ["v", 1], ǘ: ["v", 2], ǚ: ["v", 3], ǜ: ["v", 4],
  ü: ["v", 5],
};

export function toneMarkToNumber(syllable: string): string {
  let base = "";
  let tone = 5; // 找不到声调符号 → 轻声
  for (const ch of syllable) {
    const mapped = TONE_MAP[ch];
    if (mapped) {
      base += mapped[0];
      tone = mapped[1];
    } else {
      base += ch;
    }
  }
  return `${base}${tone}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// 把一个词逐字包上 <phoneme>，按 pinyin 里对应位置的音节强制注音。text 与
// pinyin 的字数/音节数对不上时（模型或调用方给的数据有问题），没法可靠地
// 一一对应，退化成不带注音的纯文本片段，而不是猜一个可能错位的映射。
//
// 已知缺口（D-11 讨论范围之外，留给后续复审）：这种字数不对齐的退化发生在
// SSML 请求内部，请求本身仍然按 text_type: "ssml" 发出、火山仍可能返回
// code === 3000 成功——此时 synthesize() 不会把结果标记为 degraded，尽管这
// 个词实际上并没有被强制注音。目前只有「SSML 被业务拒绝后整体回落纯文本」
// 这一条路径会置 degraded。
function buildPhonemeSpan(text: string, pinyinStr: string): string {
  const chars = Array.from(text);
  const syllables = pinyinStr.trim().split(/\s+/).filter(Boolean);
  if (chars.length === 0 || chars.length !== syllables.length) {
    return escapeXml(text);
  }
  return chars
    .map(
      (ch, i) =>
        `<phoneme alphabet="py" ph="${toneMarkToNumber(syllables[i])}">${escapeXml(ch)}</phoneme>`
    )
    .join("");
}

function buildSsmlText(input: SynthInput): string {
  const segments = planSegments(input);
  const wordSpan = buildPhonemeSpan(input.text, input.pinyin);
  const gapMs = Math.max(0, Math.floor(input.gapMs));
  const pieces = segments.map((seg) =>
    seg.kind === "label" ? escapeXml(`第${input.seqLabel}个`) : wordSpan
  );
  return `<speak>${pieces.join(`<break time="${gapMs}ms"/>`)}</speak>`;
}

function buildPayload(input: SynthInput, text: string, textType: "ssml" | "plain") {
  return {
    app: {
      appid: env.volcTtsAppId,
      token: env.volcTtsAccessToken,
      cluster: env.volcTtsCluster,
    },
    user: { uid: "tingxie" },
    audio: {
      voice_type: env.volcTtsVoice,
      encoding: "mp3",
      speed_ratio: input.speed,
    },
    request: {
      reqid: randomUUID(),
      text,
      text_type: textType,
      operation: "query",
    },
  };
}

export class VolcanoTtsProvider implements TtsProvider {
  readonly name = "volcano";

  async synthesize(input: SynthInput): Promise<SynthOutput> {
    if (env.volcTtsSsml) {
      try {
        return await this.doSynthesize(input, "ssml");
      } catch (err) {
        // D-12：只在业务错误（HTTP 200 但 code !== 3000，说明 SSML 确实被
        // 拒绝）时回落纯文本。网络/超时错误已经在 postWithRetry 里重试过 2
        // 次，再跑一遍纯文本只是徒增延迟；更糟的是如果网络恰好在这个瞬间
        // 恢复，会悄悄返回一个未经注音、听起来正常但读音可能是错的结果。
        if (!(err instanceof VolcanoBusinessError)) {
          throw err;
        }
        console.warn(
          `[tts:volcano] SSML 注音不被接受，已回落到纯文本，读音可能不准。原因：${err.message}`
        );
        const fallback = await this.doSynthesize(input, "plain");
        // D-11：标记为 degraded，调用方（lib/tts/cache.ts）据此拒绝把这个
        // 结果写进持久缓存——降级音频一旦落盘就会把错误读音永久固化。
        return { ...fallback, degraded: true };
      }
    }
    return this.doSynthesize(input, "plain");
  }

  private async doSynthesize(input: SynthInput, textType: "ssml" | "plain"): Promise<SynthOutput> {
    const text = textType === "ssml" ? buildSsmlText(input) : buildPlainText(input);
    const payload = buildPayload(input, text, textType);
    const headers: Record<string, string> = {
      // 火山特有写法：分号而非空格。
      Authorization: `Bearer;${env.volcTtsAccessToken}`,
      "Content-Type": "application/json",
    };
    const json = await postWithRetry(env.volcTtsBaseUrl, payload, headers);
    if (json.code !== 3000) {
      throw new VolcanoBusinessError(
        json.code,
        `火山 TTS 合成失败: code=${json.code} message=${json.message ?? "(无)"}`
      );
    }
    if (!json.data) {
      throw new VolcanoBusinessError(json.code, "火山 TTS 返回成功但 data 字段为空");
    }
    return { audio: Buffer.from(json.data, "base64"), mime: "audio/mpeg" };
  }
}
