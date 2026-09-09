import fs from "node:fs";
import { ensureDataDirs, paths } from "../env";
import { openDriver, type DbDriver } from "./driver";
import { SCHEMA_SQL } from "./schema";

// Next.js dev mode reloads this module on every edit; cache on globalThis so
// we don't reopen the sqlite file (and re-run schema) each time.
const globalForDb = globalThis as unknown as { __tingxieDb?: DbDriver };

interface ColumnInfo {
  name: string;
}

interface SqliteMasterRow {
  sql: string | null;
}

// This stage has no real user data yet, so a stale on-disk schema (from
// before a column or a primary key changed) is simplest to fix by rebuilding
// rather than writing a migration framework — see PROJECT.md §11 D-2 and D-15.
function needsRebuild(driver: DbDriver): boolean {
  const columns = driver.prepare<ColumnInfo>(`PRAGMA table_info(worksheet_word)`).all();
  if (columns.length === 0) return false; // table doesn't exist yet; SCHEMA_SQL below creates it fresh

  const missingRowPinyin = !columns.some((c) => c.name === "row_pinyin");

  const masterRow = driver
    .prepare<SqliteMasterRow>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'worksheet_word'`
    )
    .get();
  // Old PK was "PRIMARY KEY (worksheet_id, word_id)"; new one adds ", bucket)".
  const stalePrimaryKey = !(masterRow?.sql ?? "").includes("bucket)");

  return missingRowPinyin || stalePrimaryKey;
}

function init(): DbDriver {
  ensureDataDirs();
  let driver = openDriver(paths.db);

  if (needsRebuild(driver)) {
    console.warn(
      "[db] worksheet_word 表结构过期（缺 row_pinyin 列或主键未含 bucket），当前阶段无正式数据，直接删库重建。"
    );
    driver.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = paths.db + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    driver = openDriver(paths.db);
  }

  driver.exec(SCHEMA_SQL);
  return driver;
}

export const db: DbDriver = globalForDb.__tingxieDb ?? init();
globalForDb.__tingxieDb = db;
