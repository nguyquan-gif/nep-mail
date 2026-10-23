#!/usr/bin/env node
/**
 * Report where a test message actually landed: inbox or spam.
 *
 *   node --env-file=.env scripts/check-placement.mjs "subject fragment"
 *
 * Uses the BOUNCE_IMAP_* mailbox (the same one the bounce poller reads), so it
 * answers "did Gmail put my campaign in Spam?" without opening a browser.
 */
import { ImapFlow } from "imapflow";

const needle = process.argv.slice(2).join(" ").trim();
if (!needle) {
  console.error(
    'usage: node --env-file=.env scripts/check-placement.mjs "subject fragment"',
  );
  process.exit(2);
}

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

const boxes = await client.list();
const spam = boxes.find(
  (b) => b.specialUse === "\\Junk" || /(^|[^a-z])(spam|junk|rác)/i.test(b.path),
);
const candidates = [
  { label: "INBOX", path: "INBOX" },
  ...(spam ? [{ label: `SPAM (${spam.path})`, path: spam.path }] : []),
];

for (const box of candidates) {
  let lock;
  try {
    lock = await client.getMailboxLock(box.path);
  } catch (error) {
    console.log(
      `${box.label}: cannot open (${error instanceof Error ? error.message : error})`,
    );
    continue;
  }
  try {
    const found = [];
    for await (const msg of client.fetch(
      { subject: needle },
      {
        uid: true,
        envelope: true,
        headers: ["authentication-results", "list-unsubscribe"],
      },
    )) {
      found.push(msg);
    }
    if (!found.length) {
      console.log(`${box.label}: no match`);
      continue;
    }
    console.log(`${box.label}: ${found.length} match(es)`);
    for (const msg of found.slice(-1)) {
      const headers = msg.headers?.toString("utf8") || "";
      const auth = headers
        .match(/Authentication-Results:.*(?:\r?\n\s+.*)*/i)?.[0]
        ?.replace(/\s+/g, " ");
      const dkim = headers.match(/dkim=(\w+)/i)?.[1] || "?";
      const spf = headers.match(/spf=(\w+)/i)?.[1] || "?";
      const dmarc = headers.match(/dmarc=(\w+)/i)?.[1] || "n/a";
      const unsub = /list-unsubscribe:/i.test(headers) ? "yes" : "no";
      console.log(
        `  uid ${msg.uid} | dkim=${dkim} spf=${spf} dmarc=${dmarc} | list-unsubscribe=${unsub}`,
      );
      if (auth) console.log(`  ${auth.slice(0, 200)}`);
    }
  } finally {
    lock.release();
  }
}
await client.logout();
