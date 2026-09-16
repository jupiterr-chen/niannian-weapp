// Inlined as a template string (not read from a .sql file at runtime) because
// __dirname-based file reads break under webpack/turbopack bundling once this
// module is pulled into an API route — see PROJECT.md §11 D-14.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS worksheet (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  title       TEXT,
  images      TEXT NOT NULL,          -- JSON 数组，data/images 下的相对路径
  raw_ocr     TEXT                    -- VLM 原始返回，便于复盘
);

CREATE TABLE IF NOT EXISTS word (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  pinyin      TEXT NOT NULL,          -- 带声调，空格分隔，如 "zhǎng dà"
  tts_text    TEXT,                   -- 读音修正用的替换文本，NULL 表示直接用 text
  is_single   INTEGER NOT NULL DEFAULT 0,
  first_seen  TEXT NOT NULL,
  UNIQUE(text, pinyin)
);

CREATE TABLE IF NOT EXISTS worksheet_word (
  worksheet_id INTEGER NOT NULL REFERENCES worksheet(id),
  word_id      INTEGER NOT NULL REFERENCES word(id),
  bucket       TEXT NOT NULL,         -- 'required' | 'optional'
  row_char     TEXT,                  -- 所属生字，required 的为 NULL
  row_pinyin   TEXT,                  -- 该生字的拼音（生字本身可能是多音字，必须持久化，不要现算）
  row_index    INTEGER,               -- 生字行序号，从 0 开始；required 的为 NULL
  ord          INTEGER NOT NULL,      -- 行内原始顺序 / required 内原始顺序
  PRIMARY KEY (worksheet_id, word_id, bucket)
);

CREATE TABLE IF NOT EXISTS session (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  worksheet_id INTEGER REFERENCES worksheet(id),
  created_at   TEXT NOT NULL,
  settings     TEXT NOT NULL,         -- JSON: {repeat,gapMs,speed,voice}
  cursor       INTEGER NOT NULL DEFAULT 0,
  finished_at  TEXT,
  duration_ms  INTEGER                -- 客户端上报的本次听写用时（断点续做会累计）
);

CREATE TABLE IF NOT EXISTS attempt (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES session(id),
  word_id      INTEGER NOT NULL REFERENCES word(id),
  seq          INTEGER NOT NULL,      -- 从 1 开始
  bucket       TEXT NOT NULL,
  status       TEXT NOT NULL,         -- 'pending' | 'written' | 'skipped'
  replay_count INTEGER NOT NULL DEFAULT 0,
  hint_level   INTEGER NOT NULL DEFAULT 0,   -- 0..3
  UNIQUE(session_id, seq)
);

CREATE TABLE IF NOT EXISTS mistake (
  word_id      INTEGER PRIMARY KEY REFERENCES word(id),
  skip_count   INTEGER NOT NULL DEFAULT 0,
  hint_sum     INTEGER NOT NULL DEFAULT 0,
  streak_ok    INTEGER NOT NULL DEFAULT 0,
  last_bad     TEXT,
  graduated    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attempt_session ON attempt(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_ww_sheet ON worksheet_word(worksheet_id, bucket);
`;
