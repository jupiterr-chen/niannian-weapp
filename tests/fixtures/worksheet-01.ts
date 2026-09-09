// 黄金真值：PROJECT.md §8，课文《植物妈妈有办法》。
// 数据来源：fixtures/worksheet-01.jpg（本文件把它转成 TS 常量供单元测试使用）。
import type { RowLike, WordLike } from "../../lib/core/types";

export const REQUIRED_WORDS: WordLike[] = [
  { id: 1, text: "如果", pinyin: "rú guǒ" },
  { id: 2, text: "已经", pinyin: "yǐ jīng" },
  { id: 3, text: "长大", pinyin: "zhǎng dà" },
  { id: 4, text: "告别", pinyin: "gào bié" },
  { id: 5, text: "自己", pinyin: "zì jǐ" },
  { id: 6, text: "出发", pinyin: "chū fā" },
  { id: 7, text: "动物", pinyin: "dòng wù" },
  { id: 8, text: "胆子", pinyin: "dǎn zi" },
  { id: 9, text: "肚子", pinyin: "dù zi" },
  { id: 10, text: "那里", pinyin: "nà lǐ" },
  { id: 11, text: "知识", pinyin: "zhī shi" },
  { id: 12, text: "更加", pinyin: "gèng jiā" },
  { id: 13, text: "年轻", pinyin: "nián qīng" },
  { id: 14, text: "四海为家", pinyin: "sì hǎi wéi jiā" },
];

export const REQUIRED_TEXTS: string[] = REQUIRED_WORDS.map((w) => w.text);

// 生字行按原始顺序排列，每行 3 个组词。与必听词重复的词沿用同一个 id
// （对应 DB 里 (text, pinyin) 唯一约束下它们其实是同一条 word 记录）。
export const ROWS: RowLike[] = [
  {
    char: "如",
    pinyin: "rú",
    rowIndex: 0,
    words: [
      { id: 1, text: "如果", pinyin: "rú guǒ" },
      { id: 15, text: "如同", pinyin: "rú tóng" },
      { id: 16, text: "比如", pinyin: "bǐ rú" },
    ],
  },
  {
    char: "果",
    pinyin: "guǒ",
    rowIndex: 1,
    words: [
      { id: 17, text: "水果", pinyin: "shuǐ guǒ" },
      { id: 18, text: "结果", pinyin: "jié guǒ" },
      { id: 19, text: "果然", pinyin: "guǒ rán" },
    ],
  },
  {
    char: "已",
    pinyin: "yǐ",
    rowIndex: 2,
    words: [
      { id: 2, text: "已经", pinyin: "yǐ jīng" },
      { id: 20, text: "已往", pinyin: "yǐ wǎng" },
      { id: 21, text: "早已", pinyin: "zǎo yǐ" },
    ],
  },
  {
    char: "经",
    pinyin: "jīng",
    rowIndex: 3,
    words: [
      { id: 22, text: "经过", pinyin: "jīng guò" },
      { id: 23, text: "经常", pinyin: "jīng cháng" },
      { id: 24, text: "一本正经", pinyin: "yī běn zhèng jīng" },
    ],
  },
  {
    char: "别",
    pinyin: "bié",
    rowIndex: 4,
    words: [
      { id: 4, text: "告别", pinyin: "gào bié" },
      { id: 25, text: "别人", pinyin: "bié rén" },
      { id: 26, text: "分别", pinyin: "fēn bié" },
    ],
  },
  {
    char: "轻",
    pinyin: "qīng",
    rowIndex: 5,
    words: [
      { id: 13, text: "年轻", pinyin: "nián qīng" },
      { id: 27, text: "轻轻", pinyin: "qīng qīng" },
      { id: 28, text: "轻快", pinyin: "qīng kuài" },
    ],
  },
  {
    char: "发",
    pinyin: "fā",
    rowIndex: 6,
    words: [
      { id: 6, text: "出发", pinyin: "chū fā" },
      { id: 29, text: "发现", pinyin: "fā xiàn" },
      { id: 30, text: "发生", pinyin: "fā shēng" },
    ],
  },
  {
    char: "胆",
    pinyin: "dǎn",
    rowIndex: 7,
    words: [
      { id: 8, text: "胆子", pinyin: "dǎn zi" },
      { id: 31, text: "大胆", pinyin: "dà dǎn" },
      { id: 32, text: "胆小", pinyin: "dǎn xiǎo" },
    ],
  },
  {
    char: "肚",
    pinyin: "dù",
    rowIndex: 8,
    words: [
      { id: 33, text: "肚皮", pinyin: "dù pí" },
      { id: 9, text: "肚子", pinyin: "dù zi" },
      { id: 34, text: "心知肚明", pinyin: "xīn zhī dù míng" },
    ],
  },
  {
    char: "识",
    pinyin: "shí",
    rowIndex: 9,
    words: [
      { id: 35, text: "识别", pinyin: "shí bié" },
      { id: 36, text: "识字", pinyin: "shí zì" },
      { id: 37, text: "常识", pinyin: "cháng shí" },
    ],
  },
];

// 剔重后每行剩余候选数依次为（PROJECT.md §8 推导出的验收断言）：
export const EXPECTED_REMAINING_AFTER_DEDUP = [2, 3, 2, 3, 2, 2, 2, 2, 2, 3];

export const EXPECTED_REQUIRED_COUNT = 14;
export const EXPECTED_ROW_COUNT = 10;
export const EXPECTED_TOTAL_CANDIDATES = 30;
export const EXPECTED_OPTIONAL_COUNT = 10;
export const EXPECTED_TOTAL_DICTATION_COUNT = 24;

// 必须读对的多音字（§8）。
export const MULTI_PINYIN_WORDS: Record<string, string> = {
  长大: "zhǎng dà",
  一本正经: "yī běn zhèng jīng",
  心知肚明: "xīn zhī dù míng",
  识别: "shí bié",
  常识: "cháng shí",
  发现: "fā xiàn",
  出发: "chū fā",
};
