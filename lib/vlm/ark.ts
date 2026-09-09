// §5.1：火山方舟（doubao vision）是 OpenAI 兼容的 chat completions 接口。
import { env } from "../env";
import type { RecognizeResult, RecognizedRow, RecognizedWord, VlmProvider } from "./index";

// 提示词严格覆盖 §5.1「提示词要求」四条：
// 1. 必听词语是独立方框，框内所有词进 required
// 2. 左侧表格逐行返回：生字 + 拼音 + 同行组词
// 3. 每个词都要带声调拼音，多音字按本课语境定音
// 4. 不确定的写进 warnings，不要猜
// 加一条格式要求：只输出 JSON，不要 markdown 代码围栏。
const PROMPT = `你是小学二年级语文听写作业的识别助手。这是一张（或多张）听写作业单的照片，请合并识别为同一份作业。

请按以下规则识别：
1. 图片上有一个带标题的独立方框（标题通常类似"必听词语"），框内列出的所有词语，全部放进返回结果的 required 数组，不要漏项，也不要把方框外的词混进来。
2. 图片里还有一张表格，逐行列出生字：每一行包含这个生字本身、这个生字在本行的拼音，以及同一行里由这个生字组成的所有词语（通常每行 3 个）。请把表格逐行解析进 rows 数组，一行对应一个对象，保持原始行序。
3. required 和每一行 words 里的每一个词，都必须给出带声调的拼音（如 zhǎng dà），多音字必须结合本课课文的语境判断读音，不要给最常见读音敷衍了事。
4. 如果某个字迹模糊、无法确定文字或拼音，不要编造，把具体情况写成一条中文说明放进 warnings 数组。
5. 只输出一个 JSON 对象本身，不要输出任何解释性文字，不要用 markdown 代码块包裹（不要出现三个反引号）。

严格按以下结构输出 JSON（字段名必须完全一致，title 识别不到就省略该字段）：
{
  "title": "课文标题（可选）",
  "required": [ { "text": "词语", "pinyin": "带声调拼音" } ],
  "rows": [ { "char": "生字", "pinyin": "生字在本行的拼音", "words": [ { "text": "组词", "pinyin": "带声调拼音" } ] } ],
  "warnings": [ "不确定的情况说明" ]
}`;

interface ArkContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ArkChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export class ArkVlmProvider implements VlmProvider {
  async recognize(images: Buffer[]): Promise<RecognizeResult> {
    const content: ArkContentPart[] = [{ type: "text", text: PROMPT }];
    for (const image of images) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` },
      });
    }

    const payload = {
      model: env.arkModel,
      messages: [{ role: "user", content }],
      temperature: 0,
    };

    const res = await fetch(`${env.arkBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.arkApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      throw new Error(`火山方舟识别请求失败: HTTP ${res.status} ${bodyText.slice(0, 500)}`);
    }

    const json = (await res.json()) as ArkChatResponse;
    if (json.error) {
      throw new Error(`火山方舟返回错误: ${json.error.message ?? JSON.stringify(json.error)}`);
    }
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error(`火山方舟返回内容为空。原始响应前 500 字：${JSON.stringify(json).slice(0, 500)}`);
    }

    return parseArkResponse(raw);
  }
}

// 模型经常习惯性地把 JSON 包一层 ```json ... ``` 代码围栏，即便提示词已经
// 明确要求不要这样做。先按标准围栏格式剥离；剥不掉再退化成截取第一个 { 到
// 最后一个 } 之间的内容（应付模型偶尔在 JSON 前后加几句解释文字的情况）。
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

function parseArkResponse(raw: string): RecognizeResult {
  const cleaned = stripCodeFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `火山方舟返回内容无法解析为 JSON：${reason}。原始内容前 500 字：${raw.slice(0, 500)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`火山方舟返回的 JSON 不是对象。原始内容前 500 字：${raw.slice(0, 500)}`);
  }
  const obj = parsed as Record<string, unknown>;

  return {
    title: typeof obj.title === "string" ? obj.title : undefined,
    required: toWordArray(obj.required),
    rows: toRowArray(obj.rows),
    warnings: Array.isArray(obj.warnings)
      ? obj.warnings.filter((w): w is string => typeof w === "string")
      : [],
  };
}

function toWordArray(value: unknown): RecognizedWord[] {
  if (!Array.isArray(value)) return [];
  const out: RecognizedWord[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.text === "string" && typeof o.pinyin === "string") {
        out.push({ text: o.text, pinyin: o.pinyin });
      }
    }
  }
  return out;
}

function toRowArray(value: unknown): RecognizedRow[] {
  if (!Array.isArray(value)) return [];
  const out: RecognizedRow[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.char === "string" && typeof o.pinyin === "string") {
        out.push({ char: o.char, pinyin: o.pinyin, words: toWordArray(o.words) });
      }
    }
  }
  return out;
}
