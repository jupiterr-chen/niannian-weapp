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
  // 后端已经把 finishSession 改成幂等的了（PROJECT.md §11 D-18：已有
  // finished_at 就只读统计、不再重算 mistakes），这里的 ref 纯粹是为了不在
  // React 开发模式 StrictMode 的「挂载→卸载→再挂载」下发两次完全一样的
  // fetch——只让请求发一次；但状态更新要看「组件此刻是否还挂载着」
  // (mountedRef)，不能看「发起这次 fetch 的是哪一次 effect 调用」，否则
  // StrictMode 的第一次 effect 会被自己的 cleanup 提前标记为「已取消」，
  // 导致 fetch 成功回来后 setResult 被错误地跳过、页面卡在「正在统计…」——
  // 这是我在实际联调时踩到的坑，教训是 mountedRef 必须在每次挂载时重置。
  const requestedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (!requestedRef.current) {
      requestedRef.current = true;
      (async () => {
        try {
          const res = await fetch(`/api/session/${sessionId}/finish`, { method: "POST" });
          if (!res.ok) {
            if (mountedRef.current) setError("统计结果没拿到，不过听写已经做完啦。");
            return;
          }
          const body = (await res.json()) as FinishResult;
          if (mountedRef.current) setResult(body);
        } catch {
          if (mountedRef.current) setError("网络好像断开了，不过听写已经做完啦。");
        } finally {
          clearLastSession();
        }
      })();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [sessionId]);

  return (
    <main className="done-shell mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-6 py-10 text-center">
      <div className="done-block">
        <h1 className="text-[clamp(36px,7vmin,64px)] font-bold">全部写完 🎉</h1>

        {result === undefined && !error && (
          <p className="text-body-fluid text-[var(--color-fg-muted)]">正在统计…</p>
        )}
        {error && <p className="text-body-fluid text-[var(--color-fg-muted)]">{error}</p>}
      </div>

      {result && (
        <div className="done-block">
          {/* D-4：hintCount 是「用过提示的词数」，不是提示次数总和。 */}
          <p className="text-body-fluid text-[var(--color-fg-muted)]">
            共 {result.total} 个 · 跳过 {result.skipped} 个 · 有 {result.hintCount} 个词用过提示
          </p>
        </div>
      )}

      {result && result.skippedWords.length > 0 && (
        <div className="done-block">
          <section className="w-full rounded-2xl border-2 border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-4">
            <h2 className="mb-3 text-body-fluid font-bold text-[var(--color-warning)]">重点看</h2>
            <div className="flex flex-wrap justify-center gap-4">
              {result.skippedWords.map((w) => (
                <PinyinWord key={w.id} text={w.text} pinyin={w.pinyin} size="sm" />
              ))}
            </div>
          </section>
        </div>
      )}

      <div className="done-cta">
        <Link href="/" className="block w-full">
          <BigButton>回到首页</BigButton>
        </Link>
      </div>
    </main>
  );
}
