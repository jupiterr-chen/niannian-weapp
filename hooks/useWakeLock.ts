"use client";

import { useEffect } from "react";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
}

function hasWakeLock(nav: Navigator): nav is Navigator & NavigatorWithWakeLock {
  return "wakeLock" in nav;
}

// 听写页要求屏幕常亮：尝试 navigator.wakeLock，拿不到（http 环境、不支持的
// 浏览器）就静默忽略——这是预期状况，不能报错打断听写（PROJECT.md §9）。
export function useWakeLock(): void {
  useEffect(() => {
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    async function acquire() {
      try {
        if (!hasWakeLock(navigator)) return;
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await s.release().catch(() => {});
          return;
        }
        sentinel = s;
      } catch {
        // 预期失败：非安全上下文（http）、浏览器不支持、页面不可见等。忽略。
      }
    }

    void acquire();

    // 部分浏览器在标签重新可见时会自动释放 wakeLock，需要重新申请。
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && sentinel === null) {
        void acquire();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      sentinel?.release().catch(() => {});
    };
  }, []);
}
