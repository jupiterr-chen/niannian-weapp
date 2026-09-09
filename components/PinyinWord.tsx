interface PinyinWordProps {
  text: string;
  pinyin: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const HANZI_SIZE: Record<NonNullable<PinyinWordProps["size"]>, string> = {
  sm: "text-[22px]",
  md: "text-[26px]",
  lg: "text-[34px]",
};

const PINYIN_SIZE: Record<NonNullable<PinyinWordProps["size"]>, string> = {
  sm: "text-[13px]",
  md: "text-[14px]",
  lg: "text-[16px]",
};

// FR-2.7 硬要求：汉字与拼音必须同时可见，拼音在汉字上方、小一号、等宽字体，
// 不允许折叠或要点击才显示。全站凡是展示词语的地方都必须走这个组件。
export function PinyinWord({ text, pinyin, size = "md", className = "" }: PinyinWordProps) {
  return (
    <span className={`inline-flex flex-col items-center leading-tight ${className}`}>
      <span className={`pinyin text-[var(--color-fg-muted)] ${PINYIN_SIZE[size]}`}>{pinyin}</span>
      <span className={`font-semibold text-[var(--color-fg)] ${HANZI_SIZE[size]}`}>{text}</span>
    </span>
  );
}
