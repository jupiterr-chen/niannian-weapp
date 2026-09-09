// POST /api/session —— 必听在前排序后落库开一次听写会话。见 PROJECT.md §4.3、§7。
import { env } from "../../../lib/env";
import { ApiError, handler, ok } from "../../../lib/api/errors";
import {
  createSession,
  getWordsByIds,
  getWorksheetWords,
  type SessionSettings,
} from "../../../lib/db/queries";
import { buildOrder } from "../../../lib/core/order";
import type { WordRow } from "../../../lib/db/queries";

export const runtime = "nodejs";

interface SessionBody {
  worksheetId: number;
  wordIds: number[];
  settings?: Partial<SessionSettings>;
}

function parseBody(body: unknown): SessionBody {
  if (typeof body !== "object" || body === null) {
    throw new ApiError("invalid_body", 400, "请求体格式不对");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.worksheetId !== "number" || !Number.isInteger(b.worksheetId) || b.worksheetId <= 0) {
    throw new ApiError("invalid_body", 400, "worksheetId 必须是正整数");
  }
  if (!Array.isArray(b.wordIds) || b.wordIds.length === 0 || !b.wordIds.every((v) => typeof v === "number")) {
    throw new ApiError("invalid_body", 400, "wordIds 不能为空");
  }
  const settings =
    typeof b.settings === "object" && b.settings !== null
      ? (b.settings as Partial<SessionSettings>)
      : undefined;
  return { worksheetId: b.worksheetId, wordIds: b.wordIds, settings };
}

export const POST = handler(async (request: Request) => {
  const body = parseBody(await request.json());

  const { required, rows } = getWorksheetWords(body.worksheetId);
  if (required.length === 0 && rows.length === 0) {
    throw new ApiError("worksheet_not_found", 404, "找不到这份作业记录，或它还没有词表");
  }

  const requiredIdSet = new Set(required.map((w) => w.id));
  const selectedIdSet = new Set(body.wordIds);
  const wordMap = new Map(getWordsByIds(body.wordIds).map((w) => [w.id, w]));

  // 必听在前：required 按 worksheet 的原始顺序取交集；optional 按调用方传入
  // 的顺序取补集（PROJECT.md §4.3 只规定两组各自内部不打乱，不要求 optional
  // 顺序必须等于生字行序）。
  const requiredSelected: WordRow[] = required.filter((w) => selectedIdSet.has(w.id));
  const optionalSelected: WordRow[] = body.wordIds
    .filter((id) => !requiredIdSet.has(id))
    .map((id) => wordMap.get(id))
    .filter((w): w is WordRow => w !== undefined);

  if (requiredSelected.length + optionalSelected.length === 0) {
    throw new ApiError("invalid_body", 400, "wordIds 里没有一个能在这份作业里找到");
  }

  const ordered = buildOrder(requiredSelected, optionalSelected);

  const settings: SessionSettings = {
    repeat: body.settings?.repeat ?? env.ttsRepeat,
    gapMs: body.settings?.gapMs ?? env.ttsGapMs,
    speed: body.settings?.speed ?? env.ttsSpeed,
    voice: body.settings?.voice ?? env.volcTtsVoice,
  };

  const { sessionId, attempts } = createSession({
    worksheetId: body.worksheetId,
    wordIds: ordered.map((w) => w.id!),
    buckets: ordered.map((w) => w.bucket),
    settings,
  });

  return ok({
    sessionId,
    attempts: attempts.map((a) => ({ seq: a.seq, wordId: a.wordId, bucket: a.bucket })),
  });
});
