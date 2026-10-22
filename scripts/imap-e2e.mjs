/**
 * Manual end-to-end check of the IMAP bounce poller against a real server.
 *
 *   docker run -d --name nep-greenmail --user 0:0 --entrypoint /bin/sh \
 *     -p 3025:3025 -p 3143:3143 greenmail/standalone:latest \
 *     -c 'exec /home/greenmail/run_greenmail.sh'
 *   node scripts/imap-e2e.mjs
 *
 * Delivers a DSN over SMTP, polls the mailbox over IMAP, then asserts the
 * contact was suppressed and that a second poll reads nothing.
 */
// End-to-end check of the IMAP bounce poller against GreenMail (real IMAP + SMTP).
import net from "node:net";
import { SqliteDatabase } from "file:///D:/nep-mail/selfhost/database.ts";
import { handleApi } from "file:///D:/nep-mail/src/core/api.ts";
import { createBouncePoller } from "file:///D:/nep-mail/selfhost/imap.ts";

const ORIGIN = "https://mail.nep-mail.dev";
const SMTP_HOST = process.env.E2E_SMTP_HOST || "127.0.0.1";
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT || 3025);
const IMAP_HOST = process.env.E2E_IMAP_HOST || "127.0.0.1";
const IMAP_PORT = Number(process.env.E2E_IMAP_PORT || 3143);
const USER = process.env.E2E_IMAP_USER || "bounce@example.vn";

const DSN = [
  "From: MAILER-DAEMON@nep-mail.dev",
  `To: ${USER}`,
  "Subject: Undelivered Mail Returned to Sender",
  "Content-Type: text/plain; charset=utf-8",
  "MIME-Version: 1.0",
  "",
  "Final-Recipient: rfc822; gone@example.com",
  "Action: failed",
  "Status: 5.1.1",
  "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
  "",
].join("\r\n");

function smtpSend(message, to) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(SMTP_PORT, SMTP_HOST);
    let buffer = "";
    let step = 0;
    socket.setTimeout(10000, () => {
      socket.destroy();
      reject(new Error("smtp timeout"));
    });
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.trim().split(/\r?\n/);
      const last = lines[lines.length - 1];
      if (!/^\d{3} /.test(last)) return;
      buffer = "";
      if (Number(last.slice(0, 3)) >= 400) return reject(new Error(last));
      if (step === 0) {
        socket.write("EHLO nep-mail.test\r\n");
        step = 1;
      } else if (step === 1) {
        socket.write("MAIL FROM:<bounce@nep-mail.dev>\r\n");
        step = 2;
      } else if (step === 2) {
        socket.write(`RCPT TO:<${to}>\r\n`);
        step = 3;
      } else if (step === 3) {
        socket.write("DATA\r\n");
        step = 4;
      } else if (step === 4) {
        socket.write(message.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n");
        step = 5;
      } else if (step === 5) {
        socket.write("QUIT\r\n");
        socket.end();
        resolve(true);
      }
    });
  });
}

const db = new SqliteDatabase(":memory:");
db.migrate("D:/nep-mail/drizzle");
const context = {
  db,
  user: { id: "u", email: "a@nep-mail.dev", name: "A" },
  config: {
    runtime: "test",
    liveEnabled: false,
    sender: "mail@nep-mail.dev",
    unsubscribeSecret: "s".repeat(40),
    publicUnsubscribeOrigin: ORIGIN,
    transport: {
      async send() {
        return { id: "x" };
      },
    },
  },
};

async function api(path, method, body) {
  const response = await handleApi(
    new Request(`${ORIGIN}/api/${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
    context,
  );
  return {
    status: response.status,
    data: await response.json().catch(() => null),
  };
}

const workspace = await api("workspaces", "POST", { name: "Nếp IMAP" });
const w = workspace.data.id;
await api(`workspaces/${w}/contacts`, "POST", {
  email: "gone@example.com",
  name: "Gone",
  consent: true,
  consentSource: "Biểu mẫu",
});
await smtpSend(DSN, USER);
console.log("dsn delivered over SMTP");

const poller = createBouncePoller({
  options: {
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: false,
    user: USER,
    pass: "pass",
    mailbox: "INBOX",
    intervalMs: 60000,
    batch: 25,
  },
  context,
  log: (line, detail) => console.log("log:", line, JSON.stringify(detail)),
});

const first = await poller.pollOnce();
console.log("poll #1", JSON.stringify(first));
const row = db.raw
  .prepare("SELECT status,consent FROM contacts WHERE email=?")
  .get("gone@example.com");
console.log("contact after poll", JSON.stringify(row));

const second = await poller.pollOnce();
console.log("poll #2", JSON.stringify(second));

const audit = db.raw
  .prepare(
    "SELECT action,detail,actor FROM audit WHERE action LIKE 'contact.%'",
  )
  .all();
console.log("audit", JSON.stringify(audit));

const ok =
  first.messages >= 1 &&
  first.events === 1 &&
  first.suppressed === 1 &&
  row.status === "suppressed" &&
  second.messages === 0;
console.log(ok ? "E2E PASS" : "E2E FAIL");
process.exit(ok ? 0 : 1);
