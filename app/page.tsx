"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BigButton } from "@/components/BigButton";
import { LAST_SESSION_KEY } from "@/components/clientStorage";

export default function Home() {
  // 「继续上次」只在本地确实记着一个未结束会话时才出现——避免长辈在没有会话
  // 时看到一个点了就报错的按钮。用 useState+useEffect 而不是直接读
  // localStorage，是为了不在 SSR/hydration 阶段读浏览器 API。
  const [lastSessionId, setLastSessionId] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { sessionId?: number };
      if (typeof parsed.sessionId === "number") setLastSessionId(parsed.sessionId);
    } catch {
      // 本地存储损坏或不可用，当作没有未完成会话处理。
    }
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-10">
      <div className="mb-4 text-center">
        <h1 className="text-[28px] font-bold">听写助手</h1>
        <p className="mt-2 text-[17px] text-[var(--color-fg-muted)]">拍下作业，帮孩子听写生字词</p>
      </div>

      <Link href="/upload" className="block">
        <BigButton variant="primary" className="!h-[46vh] min-h-[220px] !text-[30px]">
          📷 上传今天的作业
        </BigButton>
      </Link>

      {lastSessionId !== null && (
        <Link href={`/dictation/${lastSessionId}`} className="block">
          <BigButton variant="secondary">继续上次听写</BigButton>
        </Link>
      )}

      <Link href="/history" className="block">
        <BigButton variant="ghost">历史记录</BigButton>
      </Link>
    </main>
  );
}
