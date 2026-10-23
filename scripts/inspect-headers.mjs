import { ImapFlow } from "imapflow";

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
  const found = [];
  for await (const msg of client.fetch(
    { subject: "Nếp Mail relay check" },
    { uid: true, headers: true, envelope: true },
  )) {
    found.push(msg);
  }
  found.sort((a, b) => b.uid - a.uid);
  const latest = found[0];
  if (!latest) {
    console.log("no matching message");
  } else {
    const text = latest.headers.toString("utf8");
    const pick = (name) =>
      text
        .split(/\r?\n(?=[A-Za-z-]+:)/)
        .filter((h) => h.toLowerCase().startsWith(name.toLowerCase() + ":"))
        .map((h) => h.replace(/\r?\n\s+/g, " ").slice(0, 300));
    for (const h of [
      "Authentication-Results",
      "Received-SPF",
      "DKIM-Signature",
      "List-Unsubscribe",
      "List-Unsubscribe-Post",
      "Return-Path",
      "From",
      "X-Mailer",
      "X-Sib-Id",
    ]) {
      const values = pick(h);
      console.log(`${h}: ${values.length ? values.join(" || ") : "(absent)"}`);
    }
  }
} finally {
  lock.release();
  await client.logout();
}
