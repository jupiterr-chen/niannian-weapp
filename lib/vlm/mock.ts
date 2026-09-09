// §5.1：mock 返回 PROJECT.md §8 的黄金真值，让前端和 API 在没有密钥时也能
// 完整跑通。直接 import 测试用的黄金真值常量，避免两处手抄导致不一致。
import { REQUIRED_WORDS, ROWS } from "../../tests/fixtures/worksheet-01";
import type { RecognizeResult, RecognizedRow, RecognizedWord, VlmProvider } from "./index";

export class MockVlmProvider implements VlmProvider {
  async recognize(_images: Buffer[]): Promise<RecognizeResult> {
    const required: RecognizedWord[] = REQUIRED_WORDS.map((w) => ({
      text: w.text,
      pinyin: w.pinyin,
    }));
    const rows: RecognizedRow[] = ROWS.map((row) => ({
      char: row.char,
      pinyin: row.pinyin,
      words: row.words.map((w) => ({ text: w.text, pinyin: w.pinyin })),
    }));

    return {
      title: "植物妈妈有办法",
      required,
      rows,
      warnings: ["当前使用 mock 识别结果，未调用真实模型"],
    };
  }
}
