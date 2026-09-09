"use client";

import { useLongPress } from "@/hooks/useLongPress";

interface LongPressButtonProps {
  label: string;
  durationMs?: number;
  onComplete: () => void;
  className?: string;
}

// 「结束听写」专用：短按无效，必须按满 durationMs 才触发，按住时用进度条
// 给出明确反馈（PROJECT.md §9）。
export function LongPressButton({
  label,
  durationMs = 1000,
  onComplete,
  className = "",
}: LongPressButtonProps) {
  const { progress, pressing, handlers } = useLongPress({ durationMs, onComplete });

  return (
    <button
      type="button"
      className={`focus-ring relative overflow-hidden rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-2 text-[16px] text-[var(--color-fg-muted)] select-none ${className}`}
      style={{ touchAction: "none" }}
      {...handlers}
      aria-label={`${label}，需要长按 1 秒`}
    >
      <span
        className="absolute inset-y-0 left-0 bg-[var(--color-danger)]/25"
        style={{ width: `${progress * 100}%`, transition: pressing ? "none" : "width 120ms ease-out" }}
        aria-hidden
      />
      <span className="relative">{pressing ? "长按中，别松手…" : label}</span>
    </button>
  );
}
