import { db } from "./index";

export type Bucket = "required" | "optional";
export type AttemptStatus = "pending" | "written" | "skipped";

export interface Worksheet {
  id: number;
  createdAt: string;
  title: string | null;
  images: string[];
  rawOcr: string | null;
}

export interface WordRow {
  id: number;
  text: string;
  pinyin: string;
  ttsText: string | null;
  isSingle: boolean;
  firstSeen: string;
}

export interface WordInput {
  wordId: number;
}

export interface RowInput {
  char: string;
  pinyin: string; // VLM-determined reading for this 生字; persisted, never re-derived (PROJECT.md §11 D-2)
  rowIndex: number;
  wordIds: number[]; // original in-row order
}

export interface WorksheetRowGroup {
  char: string;
  pinyin: string;
  rowIndex: number;
  words: WordRow[];
}

export interface SessionSettings {
  repeat: number;
  gapMs: number;
  speed: number;
  voice: string;
}

export interface SessionRow {
  id: number;
  worksheetId: number | null;
  createdAt: string;
  settings: SessionSettings;
  cursor: number;
  finishedAt: string | null;
}

export interface AttemptRow {
  id: number;
  sessionId: number;
  wordId: number;
  seq: number;
  bucket: Bucket;
  status: AttemptStatus;
  replayCount: number;
  hintLevel: number;
}

export interface MistakeRow {
  wordId: number;
  skipCount: number;
  hintSum: number;
  streakOk: number;
  lastBad: string | null;
  graduated: boolean;
}

export interface HistoryRow {
  sessionId: number;
  worksheetId: number | null;
  worksheetTitle: string | null;
  createdAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  total: number;
  skipped: number;
}

// --- internal row shapes (raw sqlite columns) -----------------------------

interface WordDbRow {
  id: number;
  text: string;
  pinyin: string;
  tts_text: string | null;
  is_single: number;
  first_seen: string;
}

interface WorksheetDbRow {
  id: number;
  created_at: string;
  title: string | null;
  images: string;
  raw_ocr: string | null;
}

interface WorksheetWordDbRow {
  worksheet_id: number;
  word_id: number;
  bucket: Bucket;
  row_char: string | null;
  row_pinyin: string | null;
  row_index: number | null;
  ord: number;
}

interface SessionDbRow {
  id: number;
  worksheet_id: number | null;
  created_at: string;
  settings: string;
  cursor: number;
  finished_at: string | null;
}

interface AttemptDbRow {
  id: number;
  session_id: number;
  word_id: number;
  seq: number;
  bucket: Bucket;
  status: AttemptStatus;
  replay_count: number;
  hint_level: number;
}

interface MistakeDbRow {
  word_id: number;
  skip_count: number;
  hint_sum: number;
  streak_ok: number;
  last_bad: string | null;
  graduated: number;
}

function toWordRow(r: WordDbRow): WordRow {
  return {
    id: r.id,
    text: r.text,
    pinyin: r.pinyin,
    ttsText: r.tts_text,
    isSingle: r.is_single === 1,
    firstSeen: r.first_seen,
  };
}

function toAttemptRow(r: AttemptDbRow): AttemptRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    wordId: r.word_id,
    seq: r.seq,
    bucket: r.bucket,
    status: r.status,
    replayCount: r.replay_count,
    hintLevel: r.hint_level,
  };
}

function toMistakeRow(r: MistakeDbRow): MistakeRow {
  return {
    wordId: r.word_id,
    skipCount: r.skip_count,
    hintSum: r.hint_sum,
    streakOk: r.streak_ok,
    lastBad: r.last_bad,
    graduated: r.graduated === 1,
  };
}

function placeholders(count: number): string {
  return Array(count).fill("?").join(",");
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- worksheet --------------------------------------------------------------

export function createWorksheet(input: {
  title?: string;
  images: string[];
  rawOcr?: string;
}): number {
  const stmt = db.prepare<{ id: number }>(
    `INSERT INTO worksheet (created_at, title, images, raw_ocr) VALUES (?, ?, ?, ?)`
  );
  const result = stmt.run(
    nowIso(),
    input.title ?? null,
    JSON.stringify(input.images),
    input.rawOcr ?? null
  );
  return Number(result.lastInsertRowid);
}

export function getWorksheet(id: number): Worksheet | null {
  const row = db
    .prepare<WorksheetDbRow>(`SELECT * FROM worksheet WHERE id = ?`)
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    title: row.title,
    images: JSON.parse(row.images) as string[],
    rawOcr: row.raw_ocr,
  };
}

export const saveWorksheetWords = db.transaction(
  (worksheetId: number, required: WordInput[], rows: RowInput[]): void => {
    db.prepare(`DELETE FROM worksheet_word WHERE worksheet_id = ?`).run(
      worksheetId
    );

    const insert = db.prepare(
      `INSERT INTO worksheet_word (worksheet_id, word_id, bucket, row_char, row_pinyin, row_index, ord)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    required.forEach((w, i) => {
      insert.run(worksheetId, w.wordId, "required", null, null, null, i);
    });

    for (const row of rows) {
      row.wordIds.forEach((wordId, j) => {
        insert.run(worksheetId, wordId, "optional", row.char, row.pinyin, row.rowIndex, j);
      });
    }
  }
);

export function getWorksheetWords(worksheetId: number): {
  required: WordRow[];
  rows: WorksheetRowGroup[];
} {
  const links = db
    .prepare<WorksheetWordDbRow>(
      `SELECT * FROM worksheet_word WHERE worksheet_id = ? ORDER BY bucket, row_index, ord`
    )
    .all(worksheetId);

  if (links.length === 0) return { required: [], rows: [] };

  const wordIds = [...new Set(links.map((l) => l.word_id))];
  const words = getWordsByIds(wordIds);
  const wordMap = new Map(words.map((w) => [w.id, w]));

  const required: WordRow[] = links
    .filter((l) => l.bucket === "required")
    .sort((a, b) => a.ord - b.ord)
    .map((l) => wordMap.get(l.word_id))
    .filter((w): w is WordRow => w !== undefined);

  const rowGroups = new Map<
    number,
    { char: string; pinyin: string; entries: WorksheetWordDbRow[] }
  >();
  for (const l of links) {
    if (l.bucket !== "optional" || l.row_index === null || l.row_char === null) continue;
    const group = rowGroups.get(l.row_index);
    if (group) {
      group.entries.push(l);
    } else {
      rowGroups.set(l.row_index, {
        char: l.row_char,
        pinyin: l.row_pinyin ?? "",
        entries: [l],
      });
    }
  }

  const rows: WorksheetRowGroup[] = [...rowGroups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rowIndex, group]) => ({
      char: group.char,
      // Persisted verbatim from the VLM's per-row reading (PROJECT.md §11
      // D-2) — never re-derived, since the row char can be a duoyinzi.
      pinyin: group.pinyin,
      rowIndex,
      words: group.entries
        .sort((a, b) => a.ord - b.ord)
        .map((l) => wordMap.get(l.word_id))
        .filter((w): w is WordRow => w !== undefined),
    }));

  return { required, rows };
}

// --- word ---------------------------------------------------------------

export function upsertWord(text: string, pinyin: string, isSingle = false): number {
  db.prepare(
    `INSERT INTO word (text, pinyin, is_single, first_seen) VALUES (?, ?, ?, ?)
     ON CONFLICT(text, pinyin) DO NOTHING`
  ).run(text, pinyin, isSingle ? 1 : 0, nowIso());

  const row = db
    .prepare<{ id: number }>(`SELECT id FROM word WHERE text = ? AND pinyin = ?`)
    .get(text, pinyin);
  if (!row) throw new Error(`upsertWord: 写入后仍查不到 word (${text}, ${pinyin})`);
  return row.id;
}

export function getWordsByIds(ids: number[]): WordRow[] {
  if (ids.length === 0) return [];
  const rows = db
    .prepare<WordDbRow>(`SELECT * FROM word WHERE id IN (${placeholders(ids.length)})`)
    .all(...ids);
  const map = new Map(rows.map((r) => [r.id, toWordRow(r)]));
  return ids.map((id) => map.get(id)).filter((w): w is WordRow => w !== undefined);
}

export function setWordTtsText(wordId: number, ttsText: string | null): void {
  db.prepare(`UPDATE word SET tts_text = ? WHERE id = ?`).run(ttsText, wordId);
}

// --- session --------------------------------------------------------------

export const createSession = db.transaction(
  (input: {
    worksheetId: number;
    wordIds: number[];
    buckets: Bucket[];
    settings: SessionSettings;
  }): { sessionId: number; attempts: AttemptRow[] } => {
    const sessionResult = db
      .prepare(
        `INSERT INTO session (worksheet_id, created_at, settings, cursor) VALUES (?, ?, ?, 0)`
      )
      .run(input.worksheetId, nowIso(), JSON.stringify(input.settings));
    const sessionId = Number(sessionResult.lastInsertRowid);

    const insertAttempt = db.prepare<{ id: number }>(
      `INSERT INTO attempt (session_id, word_id, seq, bucket, status, replay_count, hint_level)
       VALUES (?, ?, ?, ?, 'pending', 0, 0)`
    );

    const attempts: AttemptRow[] = input.wordIds.map((wordId, i) => {
      const seq = i + 1;
      const bucket = input.buckets[i];
      const result = insertAttempt.run(sessionId, wordId, seq, bucket);
      return {
        id: Number(result.lastInsertRowid),
        sessionId,
        wordId,
        seq,
        bucket,
        status: "pending",
        replayCount: 0,
        hintLevel: 0,
      };
    });

    return { sessionId, attempts };
  }
);

export function getSessionFull(
  sessionId: number
): { session: SessionRow; attempts: (AttemptRow & { word: WordRow })[] } | null {
  const sessionDbRow = db
    .prepare<SessionDbRow>(`SELECT * FROM session WHERE id = ?`)
    .get(sessionId);
  if (!sessionDbRow) return null;

  const session: SessionRow = {
    id: sessionDbRow.id,
    worksheetId: sessionDbRow.worksheet_id,
    createdAt: sessionDbRow.created_at,
    settings: JSON.parse(sessionDbRow.settings) as SessionSettings,
    cursor: sessionDbRow.cursor,
    finishedAt: sessionDbRow.finished_at,
  };

  const attemptDbRows = db
    .prepare<AttemptDbRow>(`SELECT * FROM attempt WHERE session_id = ? ORDER BY seq`)
    .all(sessionId);
  const words = getWordsByIds([...new Set(attemptDbRows.map((a) => a.word_id))]);
  const wordMap = new Map(words.map((w) => [w.id, w]));

  const attempts = attemptDbRows.map((a) => {
    const attempt = toAttemptRow(a);
    const word = wordMap.get(a.word_id);
    if (!word) throw new Error(`getSessionFull: attempt ${a.id} 引用了不存在的 word ${a.word_id}`);
    return { ...attempt, word };
  });

  return { session, attempts };
}

export function updateSessionCursor(sessionId: number, cursor: number): void {
  db.prepare(`UPDATE session SET cursor = ? WHERE id = ?`).run(cursor, sessionId);
}

export const finishSession = db.transaction(
  (
    sessionId: number,
    durationMs?: number
  ): { total: number; skipped: number; hintCount: number; skippedWords: WordRow[] } => {
    // Idempotent (PROJECT.md §11 D-18): a second call (double-submit, page
    // refresh on /done, StrictMode double-invoke) must not re-run
    // applyAttemptToMistakes — that would double-count skip_count/hint_sum
    // and distort §4.4 word-selection weight.
    const existing = db
      .prepare<{ finished_at: string | null }>(`SELECT finished_at FROM session WHERE id = ?`)
      .get(sessionId);
    const alreadyFinished = (existing?.finished_at ?? null) !== null;

    if (!alreadyFinished) {
      db.prepare(`UPDATE session SET finished_at = ? WHERE id = ?`).run(nowIso(), sessionId);
      applyAttemptToMistakes(sessionId);
    }
    // 用时由客户端上报；幂等重放时同值再写一次无害（D-18 语义不变）。
    if (durationMs !== undefined && Number.isFinite(durationMs)) {
      db.prepare(`UPDATE session SET duration_ms = ? WHERE id = ?`).run(
        Math.max(0, Math.round(durationMs)),
        sessionId
      );
    }

    const attemptDbRows = db
      .prepare<AttemptDbRow>(`SELECT * FROM attempt WHERE session_id = ?`)
      .all(sessionId);

    const total = attemptDbRows.length;
    const skippedRows = attemptDbRows.filter((a) => a.status === "skipped");
    const skipped = skippedRows.length;
    const hintCount = attemptDbRows.filter((a) => a.hint_level > 0).length;
    const skippedWords = getWordsByIds(skippedRows.map((a) => a.word_id));

    return { total, skipped, hintCount, skippedWords };
  }
);

// --- attempt --------------------------------------------------------------

export const updateAttempt = db.transaction(
  (
    attemptId: number,
    patch: { status?: AttemptStatus; replayCount?: number; hintLevel?: number }
  ): void => {
    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (patch.status !== undefined) {
      fields.push("status = ?");
      values.push(patch.status);
    }
    if (patch.replayCount !== undefined) {
      fields.push("replay_count = ?");
      values.push(patch.replayCount);
    }
    if (patch.hintLevel !== undefined) {
      fields.push("hint_level = ?");
      values.push(patch.hintLevel);
    }
    if (fields.length === 0) return;
    values.push(attemptId);
    db.prepare(`UPDATE attempt SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    // PROJECT.md §11 D-16: cursor tracking belongs in the data layer, not
    // leaked into the PATCH /api/attempt/:id request body as sessionId/seq.
    db.prepare(
      `UPDATE session SET cursor = MAX(cursor, (SELECT seq FROM attempt WHERE id = ?))
       WHERE id = (SELECT session_id FROM attempt WHERE id = ?)`
    ).run(attemptId, attemptId);
  }
);

// --- mistake ----------------------------------------------------------------

export function getMistakeStats(wordIds: number[]): Map<number, MistakeRow> {
  if (wordIds.length === 0) return new Map();
  const rows = db
    .prepare<MistakeDbRow>(
      `SELECT * FROM mistake WHERE word_id IN (${placeholders(wordIds.length)})`
    )
    .all(...wordIds);
  return new Map(rows.map((r) => [r.word_id, toMistakeRow(r)]));
}

export const applyAttemptToMistakes = db.transaction((sessionId: number): void => {
  const attemptDbRows = db
    .prepare<AttemptDbRow>(`SELECT * FROM attempt WHERE session_id = ?`)
    .all(sessionId);

  const getMistake = db.prepare<MistakeDbRow>(`SELECT * FROM mistake WHERE word_id = ?`);
  const upsert = db.prepare(
    `INSERT INTO mistake (word_id, skip_count, hint_sum, streak_ok, last_bad, graduated)
     VALUES (@word_id, @skip_count, @hint_sum, @streak_ok, @last_bad, @graduated)
     ON CONFLICT(word_id) DO UPDATE SET
       skip_count = @skip_count,
       hint_sum = @hint_sum,
       streak_ok = @streak_ok,
       last_bad = @last_bad,
       graduated = @graduated`
  );

  for (const a of attemptDbRows) {
    const existing = getMistake.get(a.word_id);
    const current: MistakeDbRow = existing ?? {
      word_id: a.word_id,
      skip_count: 0,
      hint_sum: 0,
      streak_ok: 0,
      last_bad: null,
      graduated: 0,
    };

    const isBad = a.status === "skipped" || a.hint_level > 0;
    let next: MistakeDbRow;
    if (isBad) {
      next = {
        ...current,
        skip_count: current.skip_count + (a.status === "skipped" ? 1 : 0),
        hint_sum: current.hint_sum + a.hint_level,
        streak_ok: 0,
        last_bad: nowIso(),
        // PROJECT.md §11 D-3: a bad attempt un-graduates the word, otherwise
        // a once-graduated word's -3 weight would permanently exile it.
        graduated: 0,
      };
    } else {
      const streakOk = current.streak_ok + 1;
      next = {
        ...current,
        streak_ok: streakOk,
        graduated: streakOk >= 2 ? 1 : current.graduated,
      };
    }

    upsert.run(next);
  }
});

// --- history ----------------------------------------------------------------

interface HistoryDbRow {
  session_id: number;
  worksheet_id: number | null;
  worksheet_title: string | null;
  created_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  total: number;
  skipped: number;
}

export function listHistory(limit = 50): HistoryRow[] {
  const rows = db
    .prepare<HistoryDbRow>(
      `SELECT
         s.id AS session_id,
         s.worksheet_id AS worksheet_id,
         w.title AS worksheet_title,
         s.created_at AS created_at,
         s.finished_at AS finished_at,
         s.duration_ms AS duration_ms,
         (SELECT COUNT(*) FROM attempt WHERE attempt.session_id = s.id) AS total,
         (SELECT COUNT(*) FROM attempt WHERE attempt.session_id = s.id AND attempt.status = 'skipped') AS skipped
       FROM session s
       LEFT JOIN worksheet w ON w.id = s.worksheet_id
       ORDER BY s.created_at DESC
       LIMIT ?`
    )
    .all(limit);

  return rows.map((r) => ({
    sessionId: r.session_id,
    worksheetId: r.worksheet_id,
    worksheetTitle: r.worksheet_title,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    total: r.total,
    skipped: r.skipped,
  }));
}
