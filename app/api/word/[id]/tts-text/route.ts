// PATCH /api/word/:id/tts-text —— §5.3 第 3 层兜底：家长确认同音替换文本后
// 写入 word.tts_text，并清掉该词所有旧音频缓存（否则读音修正后家长仍然会
// 天天听到修正前的错音）。见 PROJECT.md §7、§11 D-10。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../../lib/api/errors";
import { getWordsByIds, setWordTtsText } from "../../../../../lib/db/queries";
import { invalidateWord } from "../../../../../lib/tts/cache";

export const runtime = "nodejs";

function parseTtsText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    throw new ApiError("invalid_body", 400, "请求体格式不对");
  }
  const b = body as Record<string, unknown>;
  if (b.ttsText === null) return null;
  if (typeof b.ttsText !== "string" || b.ttsText.trim().length === 0) {
    throw new ApiError("invalid_body", 400, "ttsText 必须是非空字符串（或 null 表示清除修正）");
  }
  return b.ttsText;
}

export const PATCH = handler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const wordId = parsePositiveIntId(id, "wordId");

    const word = getWordsByIds([wordId])[0];
    if (!word) {
      throw new ApiError("word_not_found", 404, "找不到这个词");
    }

    const ttsText = parseTtsText(await request.json());

    // 旧缓存是按「修正前」的有效读音文本落盘的（word.ttsText ?? word.text），
    // 必须用这个旧值去清缓存，而不是新值。
    const oldEffectiveText = word.ttsText ?? word.text;

    setWordTtsText(wordId, ttsText);
    invalidateWord(oldEffectiveText, word.pinyin);

    return ok({ ok: true });
  }
);
