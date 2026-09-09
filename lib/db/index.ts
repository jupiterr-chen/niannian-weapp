import fs from "node:fs";
import path from "node:path";
import { ensureDataDirs, paths } from "../env";
import { openDriver, type DbDriver } from "./driver";

// Next.js dev mode reloads this module on every edit; cache on globalThis so
// we don't reopen the sqlite file (and re-run schema) each time.
const globalForDb = globalThis as unknown as { __tingxieDb?: DbDriver };

function init(): DbDriver {
  ensureDataDirs();
  const driver = openDriver(paths.db);
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  driver.exec(schema);
  return driver;
}

export const db: DbDriver = globalForDb.__tingxieDb ?? init();
globalForDb.__tingxieDb = db;
