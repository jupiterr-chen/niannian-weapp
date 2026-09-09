"use client";

import { useCallback, useRef, useState } from "react";

interface UseLongPressOptions {
  durationMs: number;
  onComplete: () => void;
}

interface UseLongPressResult {
  /** 0..1，按住期间的进度，用来画进度条/进度环反馈。 */
  progress: number;
  pressing: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerLeave: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

// 「结束听写」必须长按 1 秒才生效（PROJECT.md §9）。短按（松开早于 durationMs）
// 一律视为放弃，不触发 onComplete，且不留任何「已经按了一半」的残留状态。
export function useLongPress({ durationMs, onComplete }: UseLongPressOptions): UseLongPressResult {
  const [progress, setProgress] = useState(0);
  const [pressing, setPressing] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setPressing(false);
    setProgress(0);
  }, []);

  const tick = useCallback(() => {
    if (startRef.current === null) return;
    const elapsed = Date.now() - startRef.current;
    const p = Math.min(1, elapsed / durationMs);
    setProgress(p);
    if (p >= 1) {
      if (!firedRef.current) {
        firedRef.current = true;
        onComplete();
      }
      stop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [durationMs, onComplete, stop]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      firedRef.current = false;
      startRef.current = Date.now();
      setPressing(true);
      rafRef.current = requestAnimationFrame(tick);
    },
    [tick]
  );

  const onPointerUp = useCallback(() => {
    stop();
  }, [stop]);

  return {
    progress,
    pressing,
    handlers: {
      onPointerDown,
      onPointerUp,
      onPointerLeave: onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
