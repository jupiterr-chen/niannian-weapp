// GET/PATCH /api/worksheet/:id —— 只读回读 + 家长人工修正后的全量词表覆盖写入。
// 见 PROJECT.md §7、§11 D-19、D-20。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../lib/api/errors";
import {
  getWorksheet,
  getWorksheetWords,
  saveWorksheetWords,
  upsertWord,
  type RowInput,
  type WordInput,
} from "../../../../lib/db/queries";
import { crossCheckPinyin, type RecognizeResult } from "../../../../lib/vlm";
import { normalize } from "../../../../lib/core/normalize";

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

// --- 输出信封：GET/POST/PATCH 三个端点共用同一套形状（PROJECT.md §11 D-19、
// D-20）------------------------------------------------------------------

interface RequiredWordOut {
  id: number;
  text: string;
  pinyin: string;
  pinyinUncertain: boolean;
}

interface RowWordOut extends RequiredWordOut {
  duplicateOfRequired: boolean;
}

interface RowOut {
  char: string;
  pinyin: string;
  rowIndex: number;
  words: RowWordOut[];
}

interface WorksheetPayload {
  worksheetId: number;
  title: string | null;
  required: RequiredWordOut[];
  rows: RowOut[];
  warnings: string[];
}

// worksheet.raw_ocr 是 VLM 原始返回（或识别失败时的 {error} 记录），两种
// 情况下都可能没有 warnings 字段——统一退化为空数组，不抛错。
function recoverWarnings(rawOcr: string | null): string[] {
  if (!rawOcr) return [];
  try {
    const parsed: unknown = JSON.parse(rawOcr);
    if (typeof parsed !== "object" || parsed === null) return [];
    const warnings = (parsed as { warnings?: unknown }).warnings;
    if (Array.isArray(warnings) && warnings.every((w) => typeof w === "string")) {
      return warnings;
    }
  } catch {
    // 不是合法 JSON，视为无法恢复。
  }
  return [];
}

// GET 和 PATCH 共用：把 DB 里的权威状态组装成与 POST /api/worksheet 一致的
// 信封。pinyinUncertain 和 duplicateOfRequired 都是现算的——schema 里没有
// 持久化这两个派生字段的列，现算保证无论词表是识别来的还是家长手改的，结
// 果都自洽，不会有「PATCH 之后 GET 出来的标记和刚识别时不一样」的分叉。
function buildWorksheetPayload(worksheetId: number): WorksheetPayload | null {
  const worksheet = getWorksheet(worksheetId);
  if (!worksheet) return null;

  const { required: requiredRows, rows: rowGroups } = getWorksheetWords(worksheetId);

  const fakeResult: RecognizeResult = {
    title: worksheet.title ?? undefined,
    required: requiredRows.map((w) => ({ text: w.text, pinyin: w.pinyin })),
    rows: rowGroups.map((row) => ({
      char: row.char,
      pinyin: row.pinyin,
      words: row.words.map((w) => ({ text: w.text, pinyin: w.pinyin })),
    })),
    warnings: [],
  };
  const checked = crossCheckPinyin(fakeResult);

  const requiredNormSet = new Set(requiredRows.map((w) => normalize(w.text)));

  const required: RequiredWordOut[] = requiredRows.map((w, i) => ({
    id: w.id,
    text: w.text,
    pinyin: w.pinyin,
    pinyinUncertain: checked.required[i]?.pinyinUncertain ?? false,
  }));

  const rows: RowOut[] = rowGroups.map((row, ri) => ({
    char: row.char,
    pinyin: row.pinyin,
    rowIndex: row.rowIndex,
    words: row.words.map((w, wi) => ({
      id: w.id,
      text: w.text,
      pinyin: w.pinyin,
      pinyinUncertain: checked.rows[ri]?.words[wi]?.pinyinUncertain ?? false,
      duplicateOfRequired: requiredNormSet.has(normalize(w.text)),
    })),
  }));

  return {
    worksheetId,
    title: worksheet.title,
    required,
    rows,
    warnings: recoverWarnings(worksheet.rawOcr),
  };
}

// D-19：选词页原本靠 sessionStorage 传数据，家长一刷新就全丢了，只能退回
// 重新上传。这是识别链路唯一的人工闸口，补一个只读接口顶住。
export const GET = handler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const worksheetId = parsePositiveIntId(id, "worksheetId");

    const payload = buildWorksheetPayload(worksheetId);
    if (!payload) {
      throw new ApiError("worksheet_not_found", 404, "找不到这份作业记录");
    }
    return ok(payload);
  }
);

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

    // D-15：worksheet_word 主键已扩为 (worksheet_id, word_id, bucket)，不再
    // 需要按 word_id 去重——完整的、未过滤的行数据原样落库，剔重交给
    // pickOptional 按文本处理。
    const rowsInput: RowInput[] = body.rows.map((row) => ({
      char: row.char,
      pinyin: row.pinyin,
      rowIndex: row.rowIndex,
      wordIds: row.words.map((w) => upsertWord(w.text, w.pinyin)),
    }));

    saveWorksheetWords(worksheetId, requiredInput, rowsInput);

    // 契约说明（见任务报告）：§7 原文里 PATCH 只回 { ok: true }，但 D-20 明确
    // 要求 PATCH 的 rows[].words[] 也带 duplicateOfRequired，只有把响应换成
    // 和 GET/POST 一致的全量信封才做得到——这里按 D-20 的字面要求实现。
    const payload = buildWorksheetPayload(worksheetId);
    if (!payload) {
      throw new ApiError("internal_error", 500, "保存后无法读回词表");
    }
    return ok(payload);
  }
);
