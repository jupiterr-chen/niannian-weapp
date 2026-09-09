// POST /api/worksheet/:id/pick —— 每行择一的「帮我选」。见 PROJECT.md §4.2、§7、§11 D-17。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../../lib/api/errors";
import { getMistakeStats, getWorksheetWords } from "../../../../../lib/db/queries";
import { pickOptional } from "../../../../../lib/core/select";
import { normalize } from "../../../../../lib/core/normalize";
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

    // D-17：前端要做「行内换词」，必须知道选中的词属于哪一行。pickOptional
    // 本身（lib/core/select.ts，本任务不可改动）只返回 WordLike，不带行信
    // 息，但它的契约是「每个有候选的行恰好返回一个」，且遍历顺序等于 rows
    // 的原始顺序——用同样的「该行是否还有非必听候选」判定重新筛出这些
    // 「有效行」，就能和 picked 按下标一一对应，不需要碰 select.ts。
    const requiredNormSet = new Set(requiredTexts.map(normalize));
    const qualifyingRows = rowLikes.filter((row) =>
      row.words.some((w) => !requiredNormSet.has(normalize(w.text)))
    );
    if (picked.length !== qualifyingRows.length) {
      // 理论上不会发生——防御性检查，避免行信息错位地静默返回给前端。
      throw new ApiError("internal_error", 500, "选词结果与生字行数不匹配");
    }

    const optional = picked.map((w, i) => {
      if (w.id === undefined) {
        throw new ApiError("internal_error", 500, "选词结果缺少 id");
      }
      return {
        id: w.id,
        text: w.text,
        pinyin: w.pinyin,
        rowIndex: qualifyingRows[i].rowIndex,
        char: qualifyingRows[i].char,
      };
    });

    return ok({ optional });
  }
);
