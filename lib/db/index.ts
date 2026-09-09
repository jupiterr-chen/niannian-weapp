import fs from "node:fs";
import path from "node:path";
import { ensureDataDirs, paths } from "../env";
import { openDriver, type DbDriver } from "./driver";

// Next.js dev mode reloads this module on every edit; cache on globalThis so
// we don't reopen the sqlite file (and re-run schema) each time.
const globalForDb = globalThis as unknown as { __tingxieDb?: DbDriver };

interface ColumnInfo {
  name: string;
}

// This stage has no real user data yet, so a stale on-disk schema (from
// before a column was added) is simplest to fix by rebuilding rather than
// writing a migration framework — see PROJECT.md §11 D-2.
function needsRebuild(driver: DbDriver): boolean {
  const columns = driver.prepare<ColumnInfo>(`PRAGMA table_info(worksheet_word)`).all();
  if (columns.length === 0) return false; // table doesn't exist yet; schema.sql below creates it fresh
  return !columns.some((c) => c.name === "row_pinyin");
}

function init(): DbDriver {
  ensureDataDirs();
  let driver = openDriver(paths.db);

  if (needsRebuild(driver)) {
    console.warn(
      "[db] worksheet_word 表缺少 row_pinyin 列（旧结构），当前阶段无正式数据，直接删库重建。"
    );
    driver.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = paths.db + suffix;
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    driver = openDriver(paths.db);
  }

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  driver.exec(schema);
  return driver;
}

export const db: DbDriver = globalForDb.__tingxieDb ?? init();
globalForDb.__tingxieDb = db;
