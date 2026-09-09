// POST /api/worksheet/:id/pick —— 每行择一的「帮我选」。见 PROJECT.md §4.2、§7。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../../lib/api/errors";
import { getMistakeStats, getWorksheetWords } from "../../../../../lib/db/queries";
import { pickOptional } from "../../../../../lib/core/select";
import type { MistakeStat, RowLike } from "../../../../../lib/core/types";

export const runtime = "nodejs";

export const POST = handler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const worksheetId = parsePositiveIntId(id, "worksheetId");

    const { required, rows } = getWorksheetWords(worksheetId);
    if (required.length === 0 && rows.length === 0) {
      throw new ApiError("worksheet_not_found", 404, "找不到这份作业记录，或它还没有词表");
    }

    const rowLikes: RowLike[] = rows.map((row) => ({
      char: row.char,
      pinyin: row.pinyin,
      rowIndex: row.rowIndex,
      words: row.words.map((w) => ({ id: w.id, text: w.text, pinyin: w.pinyin })),
    }));

    const candidateIds = rows.flatMap((row) => row.words.map((w) => w.id));
    const mistakeRows = getMistakeStats(candidateIds);
    const stats = new Map<number, MistakeStat>();
    for (const [wordId, m] of mistakeRows) {
      stats.set(wordId, {
        skipCount: m.skipCount,
        hintSum: m.hintSum,
        lastBad: m.lastBad,
        graduated: m.graduated,
      });
    }

    const requiredTexts = required.map((w) => w.text);
    const picked = pickOptional(rowLikes, requiredTexts, stats);

    return ok({
      optional: picked.map((w) => ({ id: w.id, text: w.text, pinyin: w.pinyin })),
    });
  }
);
