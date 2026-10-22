import { DatabaseSync, backup } from "node:sqlite";
import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
const source = resolve(process.env.DATA_DIR || "data", "nep-mail.sqlite");
const destination = process.argv[2];
if (!destination || !existsSync(source))
  throw new Error(
    "Usage: node scripts/backup.mjs /absolute/path/backup.sqlite; set DATA_DIR if needed",
  );
if (existsSync(destination)) throw new Error("Refusing to overwrite a backup");
const db = new DatabaseSync(source);
try {
  await backup(db, resolve(destination));
  console.log(
    "Consistent SQLite backup saved. Protect this file; it contains contact data.",
  );
} finally {
  db.close();
}
