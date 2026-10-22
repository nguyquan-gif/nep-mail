#!/usr/bin/env node
/**
 * Ingest bounce and complaint reports into Nếp Mail.
 *
 * Usage:
 *   NEP_MAIL_URL=https://mail.example.vn NEP_MAIL_KEY=nep_… \
 *     node scripts/bounces.mjs ./maildir/new
 *
 * Accepts a directory (every regular file is treated as one raw message) or a
 * single .eml file. Bounce addresses are re-checked by the server, which owns
 * the suppression rules; this script only transports the raw message.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const target = args[0];
const url = (process.env.NEP_MAIL_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const key = process.env.NEP_MAIL_KEY || "";

if (!target) {
  console.error(
    "usage: NEP_MAIL_KEY=… node scripts/bounces.mjs <dir|file.eml>",
  );
  process.exit(2);
}
if (!key.startsWith("nep_")) {
  console.error("NEP_MAIL_KEY must be a workspace API key (nep_…)");
  process.exit(2);
}

async function filesOf(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const names = await readdir(path);
  return names.map((name) => join(path, name));
}

let received = 0;
let suppressed = 0;
let failed = 0;

for (const file of await filesOf(target)) {
  const message = await readFile(file, "utf8").catch(() => null);
  if (!message || message.length < 40) continue;
  const response = await fetch(`${url}/api/v1/bounces`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ message }),
  }).catch((error) => ({ ok: false, status: 0, statusText: String(error) }));

  if (!response.ok) {
    failed += 1;
    console.error(`${file}: ${response.status} ${response.statusText}`);
    continue;
  }
  const result = await response.json();
  received += result.received || 0;
  suppressed += result.suppressed || 0;
  console.log(
    `${file}: ${result.received} event(s), ${result.suppressed} suppressed`,
  );
}

console.log(
  `done: ${received} event(s), ${suppressed} suppressed, ${failed} failed`,
);
process.exit(failed ? 1 : 0);
