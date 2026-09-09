// 火山引擎语音合成 provider —— PROJECT.md §10.5（真实接口规格）/ §10.6（音频
// 装配）/ §11 D-8～D-13。上一代 SSML 注音接口（§5.2）已作废，全部删除。
//
// 大结构：
//   1. buildPronunciationEntry()  文本+带声调拼音 -> 发音词典条目字符串
//   2. speedToSpeechRate()        0.8/1.0 倍率 -> 火山 speech_rate 整数（推测）
//   3. JsonObjectStream           增量切分 chunked 响应里的多个 JSON 对象
//   4. requestPcm()               一次「单个文本」的 PCM 合成请求（词或「第N个」）
//   5. synthWordPart / synthLabelPart  分件缓存 + 按需请求
//   6. VolcanoTtsProvider.synthesize   按 §10.6 顺序拼出完整 PCM，套 WAV 头
import { randomUUID } from "node:crypto";
import { env } from "../env";
import { planSegments, type SynthInput, type SynthOutput, type TtsProvider } from "./index";
import { encodeWav, silencePcm } from "./wav";
import { getLabelPartCache, getWordPartCache, putLabelPartCache, putWordPartCache } from "./cache";

// ---------------------------------------------------------------------------
// 1. 发音词典条目
// ---------------------------------------------------------------------------

// 声调符号 -> 数字声调，用于拼出发音词典需要的 "(zhang3)" 这种数字声调音节。
// ü 系列按惯例写作 v（避免和 u 混淆），轻声（无声调符号）记 5。
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

// §10.5：发音词典条目上限约束——原词 ≤ 9 字符、不含空格。
const MAX_DICT_WORD_LENGTH = 9;

export interface PronunciationDictEntry {
  original: string; // 原词，如 "长大"
  entry: string; // 完整条目，如 "长大/(zhang3)(da4)"
}

// text + 带声调拼音 -> 发音词典条目。返回 null 表示这个词进不了词典：
//   - 字符数超过 9 或含空格（§10.5 硬限制）
//   - 拼音音节数与汉字数对不上（数据本身有问题，没法可靠地按位对应）
// 调用方（VolcanoTtsProvider）据此把结果标记为 degraded（任务要求 5）。
export function buildPronunciationEntry(text: string, pinyinStr: string): PronunciationDictEntry | null {
  const chars = Array.from(text);
  if (chars.length === 0 || chars.length > MAX_DICT_WORD_LENGTH || /\s/.test(text)) {
    return null;
  }
  const syllables = pinyinStr.trim().split(/\s+/).filter(Boolean);
  if (syllables.length !== chars.length) {
    return null;
  }
  const syllablePart = syllables.map((s) => `(${toneMarkToNumber(s)})`).join("");
  return { original: text, entry: `${text}/${syllablePart}` };
}

// ---------------------------------------------------------------------------
// 2. 语速映射（推测，未经真机验证 —— 见任务报告）
// ---------------------------------------------------------------------------

// 新接口 audio_params 里语速字段的文档尚未完全展开。参考同族「音频生成」
// 接口：speech_rate 是整数 [-50,100]，0 为正常、-50 为 0.5 倍速、100 为 2.0
// 倍速。三点 (0.5,-50) (1.0,0) (2.0,100) 恰好共线，斜率都是 100，所以
// 0.5~2.0 全程可以用同一条直线 rate = (speed-1)*100 表示，不需要分段：
//   1.0 -> 0（不传该字段，见下方调用处）
//   0.8 -> -20
//   0.5 -> -50
//   2.0 -> 100
// 真机若判定该字段非法，requestPcm() 会回落为不传该字段重试一次。
export function speedToSpeechRate(speed: number): number {
  const raw = Math.round((speed - 1) * 100);
  return Math.max(-50, Math.min(100, raw));
}

// ---------------------------------------------------------------------------
// 3. Chunked 响应的增量 JSON 对象切分
// ---------------------------------------------------------------------------

// 火山文档没有承诺 chunked 流里的 JSON 对象以换行分隔，也没有承诺一个 HTTP/
// TCP 分片正好落在一个完整对象的边界上——同一个对象完全可能被切成两段甚至
// 更多网络包。按行 split 或假设「一个 chunk 就是一个对象」在这两种不确定性
// 下都会偶发解析失败。这里用括号深度 + 字符串态的增量扫描：逐字符维护「是
// 否在字符串里」「上一个字符是不是转义反斜杠」「大括号嵌套深度」，深度归零
// 时就是一个完整对象，切出来 JSON.parse，剩余部分留到下次 push 继续扫描。
export class JsonObjectStream {
  // 只持久化「尚未消费完的原始文本」。深度/字符串态/对象起点这些扫描状态
  // 不跨 push() 持久化——它们每次都从当前 buffer 的开头重新推导一遍。
  //
  // 早期版本试图把扫描状态存成实例字段、每次 push 只扫「新增部分」，但循环
  // 又写成了「每次都从 i=0 开始」，等于用重新初始化前的状态去重新走一遍已经
  // 走过的前缀字符——对同一段文本重复触发 inString/depth 的变化，会把状态
  // 搅乱。真正需要跨调用保留的只有「还没拼成完整对象的原始字符」这一项；
  // 扫描状态本身是这段原始文本的纯函数，每次从头推导一遍最简单也最不容易
  // 出这类「重复消费」的错。对话框级别的控制消息体量很小，重新扫描前缀的
  // 开销可以忽略。
  private buffer = "";

  push(text: string): unknown[] {
    this.buffer += text;
    const out: unknown[] = [];
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let objectStart = -1;
    let i = 0;
    while (i < this.buffer.length) {
      const ch = this.buffer[i];
      if (objectStart === -1) {
        // 对象之间的空白/换行直接跳过，等到下一个 '{' 才算新对象开始。
        if (ch === "{") {
          objectStart = i;
          depth = 1;
          inString = false;
          escapeNext = false;
        }
        i++;
        continue;
      }
      if (inString) {
        if (escapeNext) {
          escapeNext = false;
        } else if (ch === "\\") {
          escapeNext = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const jsonText = this.buffer.slice(objectStart, i + 1);
          out.push(JSON.parse(jsonText));
          this.buffer = this.buffer.slice(i + 1);
          objectStart = -1;
          i = -1; // 下面 i++ 后变回 0，从新 buffer 的开头继续扫描
        }
      }
      i++;
    }
    return out;
  }
}

interface VolcanoStreamChunk {
  code?: number;
  message?: string;
  data?: string;
}

// §10.5：成功码是 0，不是旧版的 3000。
//
// 用真实密钥实测发现文档没提到的一点：chunked 流的最后一个分片不是
// code:0，而是 {"code":20000000,"message":"OK","data":null}——这是「整个流
// 正常结束」的收尾标记，不是错误。真正的业务错误（比如用一个不存在的音色
// 请求，实测返回 {"code":55000000,"message":"resource ID is mismatched ..."}）
// 是非 chunked 的单个 JSON 对象，且 message 是具体的错误描述，不是 "OK"。
// 所以判定标准不能是「code !== 0 就是错误」，而是「code !== 0 且不是这个
// 已知的收尾哨兵」。收尾哨兵之外任何非 0 code 都视为业务错误，不重试
// （网络类异常已经在 postWithRetry 里重试过；业务错误再重试没有意义）。
const STREAM_END_CODE = 20000000;

class VolcanoBusinessError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "VolcanoBusinessError";
  }
}

// ---------------------------------------------------------------------------
// 4. 单次「文本 -> PCM」请求
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [500, 1500]; // §5.4：网络类错误重试 2 次，指数退避
const REQUEST_TIMEOUT_MS = 15000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPcmOnce(
  url: string,
  payload: unknown,
  headers: Record<string, string>
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (res.status >= 500) {
      // 5xx 视为瞬时故障，交给上层重试。
      throw new Error(`火山 TTS HTTP ${res.status}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`火山 TTS HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.body) {
      throw new Error("火山 TTS 响应没有可读的 body（无法读取 chunked 流）");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const splitter = new JsonObjectStream();
    const audioParts: Buffer[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // { stream: true }：单个 UTF-8 多字节字符可能被切在两个网络分片之间
      // （message 字段是中文），必须用增量解码，不能对每个 chunk 独立 decode。
      const text = decoder.decode(value, { stream: true });
      for (const obj of splitter.push(text)) {
        const chunk = obj as VolcanoStreamChunk;
        if (typeof chunk.code !== "number") continue; // 形状不对的分片直接忽略
        if (chunk.code === STREAM_END_CODE) continue; // 正常收尾哨兵，不是错误
        if (chunk.code !== 0) {
          throw new VolcanoBusinessError(chunk.code, chunk.message ?? "(无 message)");
        }
        if (chunk.data) {
          audioParts.push(Buffer.from(chunk.data, "base64"));
        }
      }
    }
    return Buffer.concat(audioParts);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPcmWithRetry(
  url: string,
  payload: unknown,
  headers: Record<string, string>
): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchPcmOnce(url, payload, headers);
    } catch (err) {
      if (err instanceof VolcanoBusinessError) throw err; // 业务错误不重试
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface RequestPcmParams {
  text: string;
  speaker: string;
  sampleRate: number;
  dictEntry?: string; // 发音词典条目（buildPronunciationEntry 的 entry 字段）
  speechRate?: number; // undefined 表示不传该字段（0 = 正常速，等价于不传）
}

// §10.5 请求体：additions 是 JSON 序列化后的字符串，不是对象。
async function requestPcm(params: RequestPcmParams): Promise<Buffer> {
  const headers: Record<string, string> = {
    "X-Api-Key": env.volcTtsApiKey,
    "X-Api-Resource-Id": env.volcTtsResourceId,
    "X-Api-Request-Id": randomUUID(),
    "Content-Type": "application/json",
  };

  const audioParams: Record<string, unknown> = {
    format: "pcm",
    sample_rate: params.sampleRate,
  };
  if (params.speechRate !== undefined) {
    audioParams.speech_rate = params.speechRate;
  }
  const reqParams: Record<string, unknown> = {
    text: params.text,
    speaker: params.speaker,
    audio_params: audioParams,
  };
  if (params.dictEntry) {
    reqParams.additions = JSON.stringify({ pronunciation_dict: { tone: [params.dictEntry] } });
  }
  const payload = { req_params: reqParams };

  try {
    return await fetchPcmWithRetry(env.volcTtsBaseUrl, payload, headers);
  } catch (err) {
    // 任务要求 6：语速字段的参数形状是推测的，若真机认为 speech_rate 非法，
    // 回落为不传该字段重试一次。只在确实带了 speech_rate 且失败原因是业务
    // 错误（不是网络问题）时才做这次回落，避免把一次真正的鉴权/参数错误
    // 悄悄吞掉重试成看似成功。
    if (params.speechRate !== undefined && err instanceof VolcanoBusinessError) {
      console.warn(
        `[tts:volcano] speech_rate=${params.speechRate} 可能不被接受（${err.message}），` +
          "已回落为不传该字段重试一次（此回落逻辑未经真实密钥验证）。"
      );
      delete audioParams.speech_rate;
      return await fetchPcmWithRetry(env.volcTtsBaseUrl, payload, headers);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 5. 分件缓存：词与「第 N 个」各自独立复用
// ---------------------------------------------------------------------------

// 词的 PCM 按 (text, pinyin, speaker, sampleRate, speed) 缓存。
//
// 偏离说明：任务给出的键是 (text, pinyin, speaker, sampleRate)，不含 speed。
// 但 speed 会通过 speechRate 真实影响火山返回的音频内容（见 speedToSpeechRate），
// 缓存键不带 speed 会导致「先以 1.0 倍速合成过某词，再以 0.8 倍速请求同一个
// 词」时把 1.0 倍速的旧音频当命中直接返回——错误的语速会被缓存永久固化，
// 且不会有任何报错提示。这是一个会真实产生错误音频的问题，所以这里补上
// speed 作为键的一部分；「同一个词全项目永久复用」的缓存收益不受影响，只是
// 现在按 speed 再分一层，与代码里 speed 只有 0.8/1.0 两档的实际使用方式完全
// 兼容。已在任务报告里说明这处偏离。
async function synthWordPart(
  text: string,
  pinyin: string,
  speed: number
): Promise<{ pcm: Buffer; dictEntry: PronunciationDictEntry | null }> {
  const speaker = env.volcTtsSpeaker;
  const sampleRate = env.volcTtsSampleRate;
  const dictEntry = buildPronunciationEntry(text, pinyin);

  const cached = getWordPartCache({ text, pinyin, speaker, sampleRate, speed });
  if (cached) return { pcm: cached, dictEntry };

  const speechRateRaw = speedToSpeechRate(speed);
  const pcm = await requestPcm({
    text,
    speaker,
    sampleRate,
    dictEntry: dictEntry?.entry,
    speechRate: speechRateRaw === 0 ? undefined : speechRateRaw, // 0 = 正常速，等价于不传
  });
  putWordPartCache({ text, pinyin, speaker, sampleRate, speed }, pcm);
  return { pcm, dictEntry };
}

// 「第 N 个」的 PCM 按 (n, speaker, sampleRate) 缓存——序号是有限集合（听写
// 顺序里最多用到几十个），全项目永久复用。刻意不带 speed：报数字这类占位
// 提示音对语速不敏感，让它固定用正常语速合成，可以把「第 N 个」这一份有限
// 缓存和具体某次听写设置的 speed 完全解耦，缓存命中率更高，代价可以忽略。
async function synthLabelPart(n: number): Promise<Buffer> {
  const speaker = env.volcTtsSpeaker;
  const sampleRate = env.volcTtsSampleRate;

  const cached = getLabelPartCache({ n, speaker, sampleRate });
  if (cached) return cached;

  const pcm = await requestPcm({ text: `第${n}个`, speaker, sampleRate });
  putLabelPartCache({ n, speaker, sampleRate }, pcm);
  return pcm;
}

// ---------------------------------------------------------------------------
// 6. 装配 + WAV 封装
// ---------------------------------------------------------------------------

export class VolcanoTtsProvider implements TtsProvider {
  readonly name = "volcano";

  async synthesize(input: SynthInput): Promise<SynthOutput> {
    const sampleRate = env.volcTtsSampleRate;
    const gapMs = Math.max(0, Math.floor(input.gapMs));

    const { pcm: wordPcm, dictEntry } = await synthWordPart(input.text, input.pinyin, input.speed);
    const labelPcm =
      input.seqLabel !== undefined ? await synthLabelPart(input.seqLabel) : undefined;

    // §10.6：[第N个][静音][词][静音][词][静音][词]。用 planSegments 生成的
    // 顺序骨架（与 mock.ts 共享），逐段替换成对应的真实 PCM。
    const segments = planSegments(input);
    const parts: Buffer[] = [];
    segments.forEach((seg, i) => {
      parts.push(seg.kind === "label" ? labelPcm! : wordPcm);
      if (i < segments.length - 1) parts.push(silencePcm(gapMs, sampleRate));
    });

    const wav = encodeWav(Buffer.concat(parts), { sampleRate });
    const output: SynthOutput = { audio: wav, mime: "audio/wav" };

    // 任务要求 5：词进不了发音词典（超过 9 字符 / 含空格 / 拼音音节数与汉字
    // 数对不齐）时标记 degraded，成品层（putCache）据此拒绝落盘。
    if (dictEntry === null) {
      output.degraded = true;
      console.warn(
        `[tts:volcano] 词「${input.text}」（拼音「${input.pinyin}」）无法生成发音词典条目` +
          "（超过 9 字符 / 含空格 / 拼音音节数与汉字数不对齐），本次合成未强制注音，读音可能不准。"
      );
    }
    return output;
  }
}
