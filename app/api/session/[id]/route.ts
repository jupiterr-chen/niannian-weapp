// GET /api/session/:id —— 会话全量（含 attempts 和 word 详情），用于断点续做。
import { ApiError, handler, ok, parsePositiveIntId } from "../../../../lib/api/errors";
import { getSessionFull } from "../../../../lib/db/queries";

export const runtime = "nodejs";

export const GET = handler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const sessionId = parsePositiveIntId(id, "sessionId");

    const full = getSessionFull(sessionId);
    if (!full) {
      throw new ApiError("session_not_found", 404, "找不到这次听写记录");
    }

    return ok(full);
  }
);
