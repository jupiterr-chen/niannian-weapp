interface PinyinWordProps {
  text: string;
  pinyin: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

// PROJECT.md §11 D-27：手机竖屏上 clamp 的中间项恒取不到下限，"sm" 是选词
// 卡片/完成页/历史页公用的尺寸，下限直接用 --fs-card-hanzi / --fs-card-pinyin
// 两个响应式令牌，而不是写死的 px。md/lg 目前站内暂无调用方，保留固定值。
const HANZI_SIZE: Record<NonNullable<PinyinWordProps["size"]>, string> = {
  sm: "text-[length:var(--fs-card-hanzi)]",
  md: "text-[26px]",
  lg: "text-[34px]",
};
// 4 字词（如「四海为家」「一本正经」）在窄卡片里可以略降，但不低于 22px。
const HANZI_SIZE_LONG = "text-[length:var(--fs-card-hanzi-long)]";

const PINYIN_SIZE: Record<NonNullable<PinyinWordProps["size"]>, string> = {
  sm: "text-[length:var(--fs-card-pinyin)]",
  md: "text-[14px]",
  lg: "text-[16px]",
};

// FR-2.7 硬要求：汉字与拼音必须同时可见，拼音在汉字上方、小一号、等宽字体，
// 不允许折叠或要点击才显示。全站凡是展示词语的地方都必须走这个组件。
export function PinyinWord({ text, pinyin, size = "md", className = "" }: PinyinWordProps) {
  const hanziClass = size === "sm" && text.length >= 4 ? HANZI_SIZE_LONG : HANZI_SIZE[size];
  return (
    <span className={`inline-flex flex-col items-center leading-tight ${className}`}>
      {/* 颜色必须继承父级（currentColor），不能写死。卡片有四种底色——锁定绿、
          选中蓝、重复灰、默认——写死颜色会让选中态的蓝底上仍刷深色字，对比度
          直接掉到 §9 的 4.5:1 以下。拼音用轻微降透明度做主次，而不是换颜色。 */}
      <span className={`pinyin opacity-[0.85] ${PINYIN_SIZE[size]}`}>{pinyin}</span>
      <span className={`font-semibold ${hanziClass}`}>{text}</span>
    </span>
  );
}
