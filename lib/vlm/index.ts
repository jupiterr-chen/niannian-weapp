// §5.1 VLM provider 契约。
import { env } from "../env";
import { toPinyin, comparePinyinLoose } from "../pinyin";
import { ArkVlmProvider } from "./ark";
import { MockVlmProvider } from "./mock";

export interface RecognizedWord {
  text: string;
  pinyin: string;
  // 本地 pinyin-pro 注音与模型给的拼音不一致时置 true，前端标黄，交给家长
  // 裁决——绝不在这里自动改写模型结果。
  pinyinUncertain?: boolean;
}

export interface RecognizedRow {
  char: string;
  pinyin: string;
  words: RecognizedWord[];
}

export interface RecognizeResult {
  title?: string;
  required: RecognizedWord[];
  rows: RecognizedRow[];
  warnings: string[];
}

export interface VlmProvider {
  recognize(images: Buffer[]): Promise<RecognizeResult>;
}

export function getVlmProvider(): VlmProvider {
  return env.vlmProvider === "ark" ? new ArkVlmProvider() : new MockVlmProvider();
}

// 服务端后处理（§5.1 必做）：对每个词独立用 pinyin-pro 注音，和模型返回的
// 拼音比对；不一致就标 pinyinUncertain 并追加一条 warning。
//
// 注意：只检查「词」（required 里的词、每行 words 里的组词），不检查
// row.char 本身的拼音——生字单字可能是多音字，它在本课的读音是 VLM 结合课文
// 上下文判断出来的（如「结」在「结果」一行读 jiē），toPinyin(单字) 只会给
// 出最常见读音，拿去比对反而会制造大量假阳性（D-2 已经点明这一点）。
//
// D-13：用 comparePinyinLoose 而不是严格的 comparePinyin——pinyin-pro 对
// 「胆子」「肚子」这类不够常见的「X子/X头/…」组合给不出中性调（标成 dǎn zǐ
// 而不是词典意义上的轻声 dǎn zi），会把完全正确的模型结果恒定误标成存疑。
// 假阳性喊多了，家长会学会无视黄色标记，这条防线就整个作废了。
export function crossCheckPinyin(result: RecognizeResult): RecognizeResult {
  const warnings = [...result.warnings];

  const checkWord = (w: RecognizedWord): RecognizedWord => {
    const local = toPinyin(w.text);
    if (comparePinyinLoose(w.text, w.pinyin, local)) return w;
    warnings.push(`拼音存疑: ${w.text} 模型=${w.pinyin} 本地=${local}`);
    return { ...w, pinyinUncertain: true };
  };

  const required = result.required.map(checkWord);
  const rows = result.rows.map((row) => ({ ...row, words: row.words.map(checkWord) }));

  return { ...result, required, rows, warnings };
}
