import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("SQLite online backup restores committed rows and passes integrity check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nep-backup-"));
  const source = new DatabaseSync(join(dir, "source.sqlite"));
  let restored: DatabaseSync | undefined;
  try {
    source.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE proof(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO proof VALUES(1,'committed');",
    );
    await backup(source, join(dir, "backup.sqlite"));
    restored = new DatabaseSync(join(dir, "backup.sqlite"));
    assert.equal(
      restored.prepare("SELECT name FROM proof").get()!.name,
      "committed",
    );
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get()!.integrity_check,
      "ok",
    );
  } finally {
    restored?.close();
    source.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
