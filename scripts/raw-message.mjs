#!/usr/bin/env node
/**
 * Dump the raw MIME of the newest message matching a subject fragment, to answer
 * "is the text actually broken, or does it only look broken in the client?".
 *
 *   node --env-file=.env scripts/raw-message.mjs "subject fragment"
 */
import { ImapFlow } from "imapflow";

const needle = process.argv.slice(2).join(" ").trim();
const client = new ImapFlow({
  host: process.env.BOUNCE_IMAP_HOST,
  port: Number(process.env.BOUNCE_IMAP_PORT || 993),
  secure: process.env.BOUNCE_IMAP_SECURE !== "false",
  auth: {
    user: process.env.BOUNCE_IMAP_USER,
    pass: process.env.BOUNCE_IMAP_PASS,
  },
  logger: false,
});
await client.connect();
const lock = await client.getMailboxLock(
  process.env.BOUNCE_IMAP_MAILBOX || "INBOX",
);
try {
  let latest = null;
  for await (const msg of client.fetch(
    { subject: needle },
    { uid: true, source: true },
  )) {
    if (!latest || msg.uid > latest.uid) latest = msg;
  }
  if (!latest) {
    console.log("no match for", JSON.stringify(needle));
  } else {
    const raw = latest.source.toString("utf8");
    const [head, ...rest] = raw.split(/\r?\n\r?\n/);
    const body = rest.join("\n\n");
    console.log("--- headers ---");
    for (const line of head.split(/\r?\n/)) {
      if (
        /^(subject|from|to|content-type|content-transfer-encoding|mime-version):/i.test(
          line,
        )
      )
        console.log(line.slice(0, 220));
    }
    const html = body.slice(body.indexOf("<html"));
    const preview = html.slice(0, 400);
    console.log("--- html start ---");
    console.log(JSON.stringify(preview));
    const bad = (html.match(/\?/g) || []).length;
    const good = (html.match(/[ếộổạảăâêôơưđ]/gi) || []).length;
    console.log(`--- vietnamese chars: ${good} | literal '?' : ${bad}`);
    console.log(
      "has-meta-charset:",
      /<meta[^>]+charset=["']?utf-8/i.test(html),
    );
  }
} finally {
  lock.release();
  await client.logout();
}
