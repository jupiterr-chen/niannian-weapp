"use client";

import { PinyinWord } from "@/components/PinyinWord";

export interface ChipWord {
  id: number;
  text: string;
  pinyin: string;
  pinyinUncertain: boolean;
}

interface WordChipProps {
  word: ChipWord;
  /** locked：必听词，绿色、带锁、点击无响应。selectable：生字行候选词。 */
  mode: "locked" | "selectable";
  selected?: boolean;
  onSelect?: () => void;
  onPreview: () => void;
  onCorrect: () => void;
  previewing?: boolean;
  degraded?: boolean;
}

// 选词页里「必听词」和「生字行候选词」共用的一张卡片：汉字+拼音永远同时可见
// （FR-2.7），旁边挂喇叭试听和「读音不对」修正入口。
export function WordChip({
  word,
  mode,
  selected = false,
  onSelect,
  onPreview,
  onCorrect,
  previewing = false,
  degraded = false,
}: WordChipProps) {
  const locked = mode === "locked";
  const uncertainRing = word.pinyinUncertain
    ? "ring-4 ring-[var(--color-warning-border)]"
    : "";

  const bodyClass = locked
    ? "bg-[var(--color-locked-bg)] border-[var(--color-locked-border)] text-[var(--color-locked-fg)]"
    : selected
      ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-fg)]"
      : "bg-[var(--color-chip-bg)] border-[var(--color-border)] text-[var(--color-chip-fg)]";

  return (
    <div className={`flex flex-col gap-1 ${uncertainRing} rounded-2xl`}>
      <button
        type="button"
        onClick={locked ? undefined : onSelect}
        disabled={locked}
        aria-pressed={!locked && selected}
        className={`tap-target focus-ring flex min-w-[104px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-4 py-2 ${bodyClass} ${locked ? "cursor-default" : "cursor-pointer"}`}
      >
        {locked && <span aria-hidden className="text-[15px]">🔒 必听</span>}
        <PinyinWord text={word.text} pinyin={word.pinyin} size="sm" />
      </button>

      <div className="flex items-center justify-center gap-3 text-[15px]">
        <button
          type="button"
          onClick={onPreview}
          aria-label={`试听「${word.text}」`}
          className="focus-ring flex h-11 min-w-11 items-center justify-center rounded-full border-2 border-[var(--color-border)] px-2"
        >
          {previewing ? "…" : "🔊"}
        </button>
        <button
          type="button"
          onClick={onCorrect}
          className="focus-ring h-11 rounded-full border-2 border-[var(--color-border)] px-3 text-[var(--color-fg-muted)]"
        >
          读音不对
        </button>
      </div>

      {word.pinyinUncertain && (
        <p className="max-w-[130px] text-center text-[14px] text-[var(--color-warning)]">
          这个词的读音需要你确认
        </p>
      )}
      {degraded && (
        <p className="max-w-[130px] text-center text-[13px] text-[var(--color-fg-muted)]">
          读音可能不准
        </p>
      )}
    </div>
  );
}
