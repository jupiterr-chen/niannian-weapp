"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BigButton } from "@/components/BigButton";
import { PinyinWord } from "@/components/PinyinWord";
import { clearLastSession } from "@/components/clientStorage";

interface WordOut {
  id: number;
  text: string;
  pinyin: string;
}
interface FinishResult {
  total: number;
  skipped: number;
  hintCount: number;
  skippedWords: WordOut[];
}

export default function DonePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const [result, setResult] = useState<FinishResult | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // finishSession（lib/db/queries.ts）不是幂等的：每次调用都会把本次 attempt
  // 重新计入 mistake 统计（skip_count/hint_sum 会被再加一遍）。React 18/19
  // 在开发模式的 StrictMode 下会把 effect 故意「挂载→卸载→再挂载」一次，
  // 用 ref 挡掉这次重复调用，避免统计被平白翻倍——这是本页能做的部分；
  // 真正的幂等保护（比如已 finished_at 就跳过重算）需要后端配合，见任务报告。
  const requestedRef = useRef(false);

  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}/finish`, { method: "POST" });
        if (!res.ok) {
          if (!cancelled) setError("统计结果没拿到，不过听写已经做完啦。");
          return;
        }
        const body = (await res.json()) as FinishResult;
        if (!cancelled) setResult(body);
      } catch {
        if (!cancelled) setError("网络好像断开了，不过听写已经做完啦。");
      } finally {
        clearLastSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 px-6 py-10 text-center">
      <h1 className="text-[36px] font-bold">全部写完 🎉</h1>

      {result === undefined && !error && (
        <p className="text-[18px] text-[var(--color-fg-muted)]">正在统计…</p>
      )}
      {error && <p className="text-[18px] text-[var(--color-fg-muted)]">{error}</p>}

      {result && (
        <>
          {/* D-4：hintCount 是「用过提示的词数」，不是提示次数总和。 */}
          <p className="text-[18px] text-[var(--color-fg-muted)]">
            共 {result.total} 个 · 跳过 {result.skipped} 个 · 有 {result.hintCount} 个词用过提示
          </p>

          {result.skippedWords.length > 0 && (
            <section className="w-full rounded-2xl border-2 border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-4">
              <h2 className="mb-3 text-[18px] font-bold text-[var(--color-warning)]">重点看</h2>
              <div className="flex flex-wrap justify-center gap-4">
                {result.skippedWords.map((w) => (
                  <PinyinWord key={w.id} text={w.text} pinyin={w.pinyin} size="sm" />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Link href="/" className="w-full">
        <BigButton>回到首页</BigButton>
      </Link>
    </main>
  );
}
