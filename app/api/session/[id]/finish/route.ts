// POST /api/session/:id/finish —— 结束听写，落 mistake 统计并返回汇总。
// 见 PROJECT.md §7、§11 D-4：hintCount 是「用过提示的词数」，不是 hint_level 总和。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../../lib/api/errors";
import { finishSession, getSessionFull } from "../../../../../lib/db/queries";

export const runtime = "nodejs";

export const POST = handler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const sessionId = parsePositiveIntId(id, "sessionId");

    if (!getSessionFull(sessionId)) {
      throw new ApiError("session_not_found", 404, "找不到这次听写记录");
    }

    const { total, skipped, hintCount, skippedWords } = finishSession(sessionId);

    return ok({ total, skipped, hintCount, skippedWords });
  }
);
