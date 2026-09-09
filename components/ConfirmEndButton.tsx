"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ConfirmEndButtonProps {
  /** 「还有 N 个词没写完」——由调用方算好传入，不在组件内部猜测语义。 */
  remainingCount: number;
  onConfirmEnd: () => void;
  className?: string;
}

// PROJECT.md §11 D-23：真机上长按会被移动浏览器自己的长按菜单（文本选择/
// 上下文菜单）截胡，导致「结束」根本无法生效。改为点击 + 二次确认：平时是
// 小号低调的文字按钮，点开后是全宽面板，「继续听写」做视觉主选项、「结束」
// 做次要项，防误触的目标不变，但换成人人都懂的交互。
export function ConfirmEndButton({ remainingCount, onConfirmEnd, className = "" }: ConfirmEndButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // 打开时焦点移到「继续听写」，且能用 Esc 关闭——面板打开期间是唯一的
  // 键盘/辅助功能入口。
  useEffect(() => {
    if (!open) return;
    continueRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className={`end-trigger focus-ring ${className}`}
      >
        结束听写
      </button>

      {open && (
        // 点遮罩关闭；面板本身 stopPropagation 避免点面板内部也触发关闭。
        <div className="end-overlay" role="presentation" onClick={close}>
          <div
            className="end-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-panel-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p id="end-panel-title" className="end-panel-title">
              真的要结束吗？
            </p>
            <p className="end-panel-sub">还有 {remainingCount} 个词没写完</p>
            <button type="button" ref={continueRef} onClick={close} className="end-panel-continue focus-ring">
              继续听写
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onConfirmEnd();
              }}
              className="end-panel-stop focus-ring"
            >
              结束
            </button>
          </div>
        </div>
      )}
    </>
  );
}
