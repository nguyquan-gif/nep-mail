import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) {
  console.log(".env already exists; no credentials were changed.");
  process.exit(0);
}
const env = readFileSync(".env.example", "utf8")
  .replace(
    "replace-with-a-long-unique-password",
    randomBytes(24).toString("hex"),
  )
  .replace(
    "replace-with-64-random-hex-characters",
    randomBytes(32).toString("hex"),
  )
  .replace(
    "replace-with-another-64-random-hex-secret",
    randomBytes(32).toString("hex"),
  );
writeFileSync(".env", env, { mode: 0o600 });
console.log(
  "Created .env with independent random secrets. Find ADMIN_PASSWORD there; keep this file private.",
);
