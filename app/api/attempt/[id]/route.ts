// PATCH /api/attempt/:id —— 更新 status/replayCount/hintLevel，顺带更新
// session.cursor。见 PROJECT.md §7。
//
// 契约缺口（已在任务报告里指出）：lib/db/queries.ts 没有暴露「按 attemptId
// 查 sessionId/seq」的函数，只有 getSessionFull(sessionId)。要「顺带更新
// cursor」就必须知道这次更新属于哪个 session、seq 是多少——听写页本来就在
// /dictation/[sessionId] 下，天然持有这两个值，所以这里把它们作为请求体里
// 的可选字段接收；不传就只更新 attempt 本身，不动 cursor。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../lib/api/errors";
import {
  getSessionFull,
  updateAttempt,
  updateSessionCursor,
  type AttemptStatus,
} from "../../../../lib/db/queries";

export const runtime = "nodejs";

const VALID_STATUSES: AttemptStatus[] = ["pending", "written", "skipped"];

interface AttemptPatchBody {
  status?: AttemptStatus;
  replayCount?: number;
  hintLevel?: number;
  sessionId?: number;
  seq?: number;
}

function parseBody(body: unknown): AttemptPatchBody {
  if (typeof body !== "object" || body === null) {
    throw new ApiError("invalid_body", 400, "请求体格式不对");
  }
  const b = body as Record<string, unknown>;
  const result: AttemptPatchBody = {};

  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !VALID_STATUSES.includes(b.status as AttemptStatus)) {
      throw new ApiError("invalid_body", 400, "status 只能是 pending/written/skipped");
    }
    result.status = b.status as AttemptStatus;
  }
  if (b.replayCount !== undefined) {
    if (typeof b.replayCount !== "number" || b.replayCount < 0) {
      throw new ApiError("invalid_body", 400, "replayCount 必须是非负数");
    }
    result.replayCount = b.replayCount;
  }
  if (b.hintLevel !== undefined) {
    if (typeof b.hintLevel !== "number" || b.hintLevel < 0 || b.hintLevel > 3) {
      throw new ApiError("invalid_body", 400, "hintLevel 必须在 0 到 3 之间");
    }
    result.hintLevel = b.hintLevel;
  }
  if (b.sessionId !== undefined) {
    if (typeof b.sessionId !== "number" || !Number.isInteger(b.sessionId) || b.sessionId <= 0) {
      throw new ApiError("invalid_body", 400, "sessionId 必须是正整数");
    }
    result.sessionId = b.sessionId;
  }
  if (b.seq !== undefined) {
    if (typeof b.seq !== "number" || !Number.isInteger(b.seq) || b.seq <= 0) {
      throw new ApiError("invalid_body", 400, "seq 必须是正整数");
    }
    result.seq = b.seq;
  }
  if (
    result.status === undefined &&
    result.replayCount === undefined &&
    result.hintLevel === undefined
  ) {
    throw new ApiError("invalid_body", 400, "至少要修改 status、replayCount、hintLevel 中的一项");
  }
  return result;
}

export const PATCH = handler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const attemptId = parsePositiveIntId(id, "attemptId");
    const body = parseBody(await request.json());

    updateAttempt(attemptId, {
      status: body.status,
      replayCount: body.replayCount,
      hintLevel: body.hintLevel,
    });

    if (body.sessionId !== undefined && body.seq !== undefined) {
      const full = getSessionFull(body.sessionId);
      if (full) {
        updateSessionCursor(body.sessionId, Math.max(full.session.cursor, body.seq));
      }
    }

    return ok({ ok: true });
  }
);
