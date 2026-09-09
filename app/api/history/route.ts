// GET /api/history —— 会话列表。见 PROJECT.md §7。
import { handler, ok } from "../../../lib/api/errors";
import { listHistory } from "../../../lib/db/queries";

export const runtime = "nodejs";

export const GET = handler(async (_request: Request) => {
  return ok({ history: listHistory() });
});
