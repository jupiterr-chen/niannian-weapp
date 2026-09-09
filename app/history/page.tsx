"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BigButton } from "@/components/BigButton";
import { PinyinWord } from "@/components/PinyinWord";

interface HistoryRow {
  sessionId: number;
  worksheetId: number | null;
  worksheetTitle: string | null;
  createdAt: string;
  finishedAt: string | null;
  total: number;
  skipped: number;
}

interface WordInfo {
  id: number;
  text: string;
  pinyin: string;
}
interface AttemptInfo {
  id: number;
  seq: number;
  status: "pending" | "written" | "skipped";
  word: WordInfo;
}
interface SessionFull {
  attempts: AttemptInfo[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

// 点开某一次记录看词表时，只读 GET /api/session/:id，绝不调用
// POST /api/session/:id/finish——那个接口每次调用都会把本次 attempt 重新计入
// mistake 统计（lib/db/queries.ts 的 applyAttemptToMistakes 没有幂等保护），
// 已经结束过的会话不能再触发一次，否则跳过/提示次数会被重复累加。
export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryRow[] | null | undefined>(undefined);
  const [openSessionId, setOpenSessionId] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Record<number, SessionFull>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/history");
        if (!res.ok) {
          if (!cancelled) setHistory(null);
          return;
        }
        const body = (await res.json()) as { history: HistoryRow[] };
        if (!cancelled) setHistory(body.history);
      } catch {
        if (!cancelled) setHistory(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleOpen = useCallback(
    async (sessionId: number) => {
      if (openSessionId === sessionId) {
        setOpenSessionId(null);
        return;
      }
      setOpenSessionId(sessionId);
      if (detailCache[sessionId]) return;
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (res.ok) {
          const body = (await res.json()) as SessionFull;
          setDetailCache((prev) => ({ ...prev, [sessionId]: body }));
        }
      } finally {
        setDetailLoading(false);
      }
    },
    [openSessionId, detailCache]
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-8">
      <h1 className="text-[24px] font-bold">历史记录</h1>

      {history === undefined && <p className="text-[18px] text-[var(--color-fg-muted)]">正在加载…</p>}
      {history === null && <p className="text-[18px] text-[var(--color-fg-muted)]">加载失败了，请稍后再试。</p>}
      {history && history.length === 0 && (
        <p className="text-[18px] text-[var(--color-fg-muted)]">还没有听写记录。</p>
      )}

      <div className="flex flex-col gap-3">
        {history?.map((row) => (
          <div key={row.sessionId} className="rounded-2xl border-2 border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => toggleOpen(row.sessionId)}
              className="tap-target focus-ring flex w-full flex-col items-start justify-center gap-1 px-5 py-3 text-left"
            >
              <span className="text-[19px] font-semibold">
                {formatDate(row.createdAt)} {row.worksheetTitle ? `· ${row.worksheetTitle}` : ""}
              </span>
              <span className="text-[16px] text-[var(--color-fg-muted)]">
                共 {row.total} 个 · 跳过 {row.skipped} 个{row.finishedAt ? "" : " · 未做完"}
              </span>
            </button>

            {openSessionId === row.sessionId && (
              <div className="border-t-2 border-[var(--color-border)] p-4">
                {detailLoading && !detailCache[row.sessionId] && (
                  <p className="text-[16px] text-[var(--color-fg-muted)]">加载词表中…</p>
                )}
                {detailCache[row.sessionId] && (
                  <div className="flex flex-wrap gap-4">
                    {detailCache[row.sessionId].attempts.map((a) => (
                      <div key={a.id} className="flex flex-col items-center gap-1">
                        <PinyinWord text={a.word.text} pinyin={a.word.pinyin} size="sm" />
                        <span
                          className={`text-[13px] ${
                            a.status === "skipped"
                              ? "text-[var(--color-warning)]"
                              : "text-[var(--color-fg-muted)]"
                          }`}
                        >
                          {a.status === "written" ? "写好了" : a.status === "skipped" ? "跳过了" : "未做"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto pt-4">
        <Link href="/">
          <BigButton variant="secondary">回到首页</BigButton>
        </Link>
      </div>
    </main>
  );
}
