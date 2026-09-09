// PATCH /api/worksheet/:id —— 家长人工修正后的全量词表，覆盖写入。见 PROJECT.md §7。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../lib/api/errors";
import {
  getWorksheet,
  saveWorksheetWords,
  upsertWord,
  type RowInput,
  type WordInput,
} from "../../../../lib/db/queries";

export const runtime = "nodejs";

interface PatchWordInput {
  text: string;
  pinyin: string;
}

interface PatchRowInput {
  char: string;
  pinyin: string;
  rowIndex: number;
  words: PatchWordInput[];
}

interface PatchBody {
  required: PatchWordInput[];
  rows: PatchRowInput[];
}

function isWordInput(v: unknown): v is PatchWordInput {
  if (typeof v !== "object" || v === null) return false;
  const w = v as Record<string, unknown>;
  return typeof w.text === "string" && w.text.length > 0 && typeof w.pinyin === "string" && w.pinyin.length > 0;
}

function isRowInput(v: unknown): v is PatchRowInput {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.char === "string" &&
    r.char.length > 0 &&
    typeof r.pinyin === "string" &&
    r.pinyin.length > 0 &&
    typeof r.rowIndex === "number" &&
    Array.isArray(r.words) &&
    r.words.every(isWordInput)
  );
}

function parseBody(body: unknown): PatchBody {
  if (typeof body !== "object" || body === null) {
    throw new ApiError("invalid_body", 400, "请求体格式不对");
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.required) || !b.required.every(isWordInput)) {
    throw new ApiError("invalid_body", 400, "required 字段格式不对");
  }
  if (!Array.isArray(b.rows) || !b.rows.every(isRowInput)) {
    throw new ApiError("invalid_body", 400, "rows 字段格式不对");
  }
  return { required: b.required, rows: b.rows };
}

export const PATCH = handler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const worksheetId = parsePositiveIntId(id, "worksheetId");

    if (!getWorksheet(worksheetId)) {
      throw new ApiError("worksheet_not_found", 404, "找不到这份作业记录");
    }

    const body = parseBody(await request.json());

    const requiredInput: WordInput[] = body.required.map((w) => ({
      wordId: upsertWord(w.text, w.pinyin),
    }));
    const requiredWordIdSet = new Set(requiredInput.map((r) => r.wordId));

    // 同 POST /api/worksheet 里的说明：worksheet_word 主键 (worksheet_id,
    // word_id) 不允许同一个词既是必听词又是某行候选，这里同样按 word_id 去重
    // 后再落库，不影响 pickOptional（它按文本过滤，不看这份候选列表是否
    // 已经去重）。
    const rowsInput: RowInput[] = body.rows.map((row) => ({
      char: row.char,
      pinyin: row.pinyin,
      rowIndex: row.rowIndex,
      wordIds: row.words
        .map((w) => upsertWord(w.text, w.pinyin))
        .filter((id) => !requiredWordIdSet.has(id)),
    }));

    saveWorksheetWords(worksheetId, requiredInput, rowsInput);

    return ok({ ok: true });
  }
);
