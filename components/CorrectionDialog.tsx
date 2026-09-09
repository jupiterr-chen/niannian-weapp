"use client";

import { useState } from "react";
import { BigButton } from "@/components/BigButton";

interface CorrectionDialogProps {
  wordText: string;
  defaultValue: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

// §5.3 第 3 层兜底：家长确认同音替换文本后写入 word.tts_text。
// 不引入弹窗/对话框库，纯 div + 固定定位实现一个足够用的遮罩层。
export function CorrectionDialog({
  wordText,
  defaultValue,
  submitting,
  onCancel,
  onSubmit,
}: CorrectionDialogProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--color-bg-elevated)] p-5 shadow-xl">
        <h2 className="text-[20px] font-bold">「{wordText}」读音不对？</h2>
        <p className="mt-2 text-[16px] text-[var(--color-fg-muted)]">
          换一个读音相同或相近的词，以后就用这个词来发音。
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="tap-target focus-ring mt-4 w-full rounded-xl border-2 border-[var(--color-border)] bg-transparent px-4 text-[20px]"
          aria-label="替换后的发音文本"
        />
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="tap-target focus-ring flex-1 rounded-2xl border-2 border-[var(--color-border)] text-[18px] font-medium"
          >
            取消
          </button>
          <div className="flex-[2]">
            <BigButton
              variant="primary"
              disabled={submitting || value.trim().length === 0}
              onClick={() => onSubmit(value.trim())}
            >
              {submitting ? "保存中…" : "确认修正"}
            </BigButton>
          </div>
        </div>
      </div>
    </div>
  );
}
