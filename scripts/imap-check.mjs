#!/usr/bin/env node
/**
 * Inspect a real bounce mailbox over IMAP before enabling the poller.
 *
 *   node --env-file=.env.bounce-test scripts/imap-check.mjs --list
 *   node --env-file=.env.bounce-test scripts/imap-check.mjs --scan
 *   NEP_MAIL_URL=https://mail.example.vn NEP_MAIL_KEY=nep_… \
 *     node --env-file=.env.bounce-test scripts/imap-check.mjs --apply
 *
 * --list   connect, authenticate, list mailboxes (proves host/port/TLS/auth)
 * --scan   read unseen messages and report what would be suppressed. Read-only:
 *          nothing is flagged, nothing is sent to the app.
 * --apply  post the raw messages to /api/v1/bounces and mark them seen. This is
 *          exactly what the in-app poller does.
 *
 * Addresses are masked in the output: this script is for terminal logs and
 * screen shares, not for printing customer data.
 */
import { ImapFlow } from "imapflow";
import { parseBounce, dedupe } from "../src/core/bounce.ts";

const args = new Set(process.argv.slice(2));
const mode = args.has("--apply")
  ? "apply"
  : args.has("--scan")
    ? "scan"
    : "list";
const host = process.env.BOUNCE_IMAP_HOST || "";
const port = Number(process.env.BOUNCE_IMAP_PORT || 993);
const secure = process.env.BOUNCE_IMAP_SECURE !== "false";
const user = process.env.BOUNCE_IMAP_USER || "";
const pass = process.env.BOUNCE_IMAP_PASS || "";
const mailbox = process.env.BOUNCE_IMAP_MAILBOX || "INBOX";
const limit = Number(process.env.BOUNCE_IMAP_BATCH || 10);
const apiUrl = (process.env.NEP_MAIL_URL || "").replace(/\/$/, "");
const apiKey = process.env.NEP_MAIL_KEY || "";

const maskEmail = (address) => {
  const [local, domain] = String(address).split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
};

if (!host || !user || !pass) {
  console.error(
    "Set BOUNCE_IMAP_HOST, BOUNCE_IMAP_USER and BOUNCE_IMAP_PASS (use an app password, never your account password).",
  );
  process.exit(2);
}
if (mode === "apply" && (!apiUrl || !apiKey.startsWith("nep_"))) {
  console.error(
    "--apply needs NEP_MAIL_URL and NEP_MAIL_KEY (workspace API key).",
  );
  process.exit(2);
}

const client = new ImapFlow({
  host,
  port,
  secure,
  auth: { user, pass },
  logger: false,
  disableAutoIdle: true,
  socketTimeout: 30_000,
});

const started = Date.now();
try {
  await client.connect();
  console.log(
    `connected: ${user.replace(/^(.)[^@]*/, "$1***")} -> ${host}:${port} (${secure ? "TLS" : "plaintext"})`,
  );

  if (mode === "list") {
    const boxes = await client.list();
    console.log(`mailboxes (${boxes.length}):`);
    for (const box of boxes)
      console.log(
        `  ${box.path}${box.specialUse ? `  [${box.specialUse}]` : ""}${box.flags?.size ? `  flags=${[...box.flags].join(",")}` : ""}`,
      );
    const lock = await client.getMailboxLock(mailbox);
    try {
      console.log(
        `\n${mailbox}: ${client.mailbox.exists} message(s), uidNext=${client.mailbox.uidNext}`,
      );
    } finally {
      lock.release();
    }
    console.log("\nAuth, TLS and folder names are fine. Run --scan next.");
    process.exit(0);
  }

  const lock = await client.getMailboxLock(mailbox);
  let events = 0;
  let messages = 0;
  try {
    const unseen = (await client.search({ seen: false }, { uid: true })) || [];
    const uids = unseen.slice(-limit);
    console.log(
      `${mailbox}: ${unseen.length} unseen, inspecting ${uids.length}`,
    );
    if (!uids.length)
      console.log(
        "No unseen mail. To generate a genuine bounce, send any message to\n" +
          "  bounce@simulator.amazonses.com\n" +
          "the Amazon SES simulator returns a real DSN to the envelope sender within a minute.",
      );

    const raws = [];
    for (const uid of uids) {
      const bodies = [];
      for await (const message of client.fetch(
        String(uid),
        { source: true },
        { uid: true },
      ))
        if (message.source)
          bodies.push(Buffer.from(message.source).toString("utf8"));
      const text = bodies.join("\n");
      if (!text) continue;
      raws.push(text);
      const parsed = dedupe(parseBounce(text));
      messages += 1;
      events += parsed.length;
      const subject = (text.match(/^Subject:\s*(.+)$/im)?.[1] || "").slice(
        0,
        60,
      );
      if (!parsed.length) {
        console.log(`  uid ${uid}: not a bounce  "${subject}"`);
        continue;
      }
      for (const event of parsed)
        console.log(
          `  uid ${uid}: ${event.kind.toUpperCase()} ${maskEmail(event.email)}${event.status ? ` ${event.status}` : ""}  "${subject}"`,
        );
    }

    if (mode === "apply") {
      if (!raws.length) {
        console.log("nothing to apply");
      } else {
        let suppressed = 0;
        let received = 0;
        for (const message of raws) {
          const response = await fetch(`${apiUrl}/api/v1/bounces`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ message }),
          });
          if (!response.ok) {
            console.error(`  api ${response.status}: ${await response.text()}`);
            continue;
          }
          const result = await response.json();
          received += result.received || 0;
          suppressed += result.suppressed || 0;
        }
        console.log(
          `applied: ${received} event(s), ${suppressed} contact(s) suppressed`,
        );
        // Only flag after the app accepted the message; a failed POST is
        // retried on the next run.
        for (const uid of uids.slice(0, raws.length))
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      }
    } else {
      console.log(
        "\nread-only: nothing was flagged and nothing was sent to the app",
      );
    }
    console.log(
      `\ndone in ${Date.now() - started}ms — ${messages} message(s), ${events} bounce event(s)`,
    );
  } finally {
    lock.release();
  }
} catch (error) {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  try {
    await client.logout();
  } catch {
    /* connection already gone */
  }
}
