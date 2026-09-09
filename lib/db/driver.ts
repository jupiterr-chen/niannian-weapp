import Database from "better-sqlite3";

// Isolation layer per PROJECT.md §1: if better-sqlite3 ever fails to install on
// this Node version, only this file needs to change (e.g. to node:sqlite).

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface StatementLike<Row = unknown> {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}

export interface DbDriver {
  exec(sql: string): void;
  prepare<Row = unknown>(sql: string): StatementLike<Row>;
  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result
  ): (...args: Args) => Result;
  close(): void;
}

export function openDriver(filename: string): DbDriver {
  const raw = new Database(filename);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  return {
    exec(sql: string): void {
      raw.exec(sql);
    },
    prepare<Row>(sql: string): StatementLike<Row> {
      return raw.prepare<unknown[], Row>(sql);
    },
    transaction<Args extends unknown[], Result>(
      fn: (...args: Args) => Result
    ): (...args: Args) => Result {
      return raw.transaction(fn);
    },
    close(): void {
      raw.close();
    },
  };
}
