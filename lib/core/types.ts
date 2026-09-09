// 核心算法层最小类型定义。不引入数据库类型，保持纯函数边界干净。

export interface WordLike {
  id?: number;
  text: string;
  pinyin: string;
}

export interface RowLike {
  char: string;
  pinyin: string;
  rowIndex: number;
  words: WordLike[];
}

export interface MistakeStat {
  skipCount: number;
  hintSum: number;
  lastBad: string | null;
  graduated: boolean;
}
