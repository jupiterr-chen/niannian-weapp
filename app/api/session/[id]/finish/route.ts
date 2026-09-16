// POST /api/session/:id/finish —— 结束听写，落 mistake 统计并返回汇总。
// 见 PROJECT.md §7、§11 D-4：hintCount 是「用过提示的词数」，不是 hint_level 总和。
// body 可选 { durationMs }：客户端上报的本次听写用时，落 session.duration_ms，
// 历史记录用它展示「用时 mm:ss」。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../../lib/api/errors";
import { finishSession, getSessionFull } from "../../../../../lib/db/queries";

export const runtime = "nodejs";

export const POST = handler(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const sessionId = parsePositiveIntId(id, "sessionId");

    if (!getSessionFull(sessionId)) {
      throw new ApiError("session_not_found", 404, "找不到这次听写记录");
    }

    const body: unknown = await request.json().catch(() => null);
    let durationMs: number | undefined;
    if (
      typeof body === "object" &&
      body !== null &&
      typeof (body as { durationMs?: unknown }).durationMs === "number" &&
      Number.isFinite((body as { durationMs: number }).durationMs)
    ) {
      durationMs = Math.min((body as { durationMs: number }).durationMs, 24 * 3600 * 1000);
    }

    const { total, skipped, hintCount, skippedWords } = finishSession(sessionId, durationMs);

    return ok({ total, skipped, hintCount, skippedWords, durationMs: durationMs ?? null });
  }
);
