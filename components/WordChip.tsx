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
  /**
   * 服务端算好的 duplicateOfRequired（lib/core/normalize.ts 的权威实现，
   * PROJECT.md §11 D-20）。前端不做任何文本归一化——只在 mode="selectable"
   * 时有意义：这个候选词和某个必听词其实是同一个词，置灰、不可选。
   */
  duplicate?: boolean;
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
  duplicate = false,
  selected = false,
  onSelect,
  onPreview,
  onCorrect,
  previewing = false,
  degraded = false,
}: WordChipProps) {
  const locked = mode === "locked";
  const disabled = locked || duplicate;
  const uncertainRing = word.pinyinUncertain
    ? "ring-4 ring-[var(--color-warning-border)]"
    : "";

  const bodyClass = locked
    ? "bg-[var(--color-locked-bg)] border-[var(--color-locked-border)] text-[var(--color-locked-fg)]"
    : duplicate
      ? "bg-[var(--color-chip-bg)] border-[var(--color-border)] text-[var(--color-fg-muted)] opacity-60"
      : selected
        ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-fg)]"
        : "bg-[var(--color-chip-bg)] border-[var(--color-border)] text-[var(--color-chip-fg)]";

  return (
    <div className={`chip-card ${uncertainRing} rounded-2xl`}>
      <button
        type="button"
        onClick={disabled ? undefined : onSelect}
        disabled={disabled}
        aria-pressed={!disabled && selected}
        className={`chip-hanzi-btn focus-ring border-2 ${bodyClass} ${disabled ? "cursor-default" : "cursor-pointer"}`}
      >
        {locked && <span aria-hidden className="text-[length:var(--fs-card-pinyin)]">🔒 必听</span>}
        <PinyinWord text={word.text} pinyin={word.pinyin} size="sm" />
      </button>

      <div className="chip-actions">
        <button
          type="button"
          onClick={onPreview}
          aria-label={`试听「${word.text}」`}
          className="chip-action-btn focus-ring border-2 border-[var(--color-border)]"
        >
          {previewing ? "…" : "🔊 试听"}
        </button>
        <button
          type="button"
          onClick={onCorrect}
          aria-label={`修改「${word.text}」的读音`}
          className="chip-action-btn focus-ring border-2 border-[var(--color-border)] text-[var(--color-fg-muted)]"
        >
          {/* 手机两列布局下「读音不对」四个字会断行成「读音不 / 对」。「改读音」
              既短一个字，也更直接地说明点下去会发生什么。 */}
          ✏️ 改读音
        </button>
      </div>

      {duplicate && <p className="chip-note text-[var(--color-fg-muted)]">已在必听词里</p>}
      {word.pinyinUncertain && (
        <p className="chip-note text-[var(--color-warning)]">这个词的读音需要你确认</p>
      )}
      {degraded && <p className="chip-note text-[var(--color-fg-muted)]">读音可能不准</p>}
    </div>
  );
}
