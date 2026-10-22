import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Database, Statement } from "../src/core/types.ts";
export class SqliteDatabase implements Database {
  raw: DatabaseSync;
  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
  }
  prepare(sql: string): Statement {
    const stmt = this.raw.prepare(sql);
    let values: unknown[] = [];
    const bound: Statement = {
      bind(...v) {
        values = v;
        return Object.assign(bound, {
          execute: () => stmt.run(...(values as never[])),
        });
      },
      async first<T>() {
        return (stmt.get(...(values as never[])) || null) as T | null;
      },
      async all<T>() {
        return { results: stmt.all(...(values as never[])) as T[] };
      },
      async run() {
        return stmt.run(...(values as never[]));
      },
    };
    return Object.assign(bound, {
      execute: () => stmt.run(...(values as never[])),
    });
  }
  async batch(statements: Statement[]) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const s of statements)
        results.push((s as Statement & { execute(): unknown }).execute());
      this.raw.exec("COMMIT");
      return results;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
  migrate(dir: string) {
    this.raw.exec(
      "CREATE TABLE IF NOT EXISTS _nep_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)",
    );
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        this.raw.prepare("SELECT 1 FROM _nep_migrations WHERE name=?").get(name)
      )
        continue;
      this.raw.exec("BEGIN IMMEDIATE");
      try {
        this.raw.exec(readFileSync(resolve(dir, name), "utf8"));
        this.raw
          .prepare("INSERT INTO _nep_migrations VALUES(?,?)")
          .run(name, new Date().toISOString());
        this.raw.exec("COMMIT");
      } catch (e) {
        this.raw.exec("ROLLBACK");
        throw e;
      }
    }
  }
  close() {
    this.raw.close();
  }
}
