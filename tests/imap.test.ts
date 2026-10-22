import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../selfhost/database.ts";
import { handleApi } from "../src/core/api.ts";
import {
  createBouncePoller,
  imapOptionsFromEnv,
  type ImapClient,
  type ImapOptions,
} from "../selfhost/imap.ts";
import type { Context } from "../src/core/types.ts";
import { ImapFlow } from "imapflow";

const who = { id: "user-a", email: "a@nep-mail.dev", name: "Người A" };
const ORIGIN = "https://mail.nep-mail.dev";

function fixture() {
  const db = new SqliteDatabase(":memory:");
  db.migrate("drizzle");
  const c: Context = {
    db,
    user: who,
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
  return { db, c };
}

async function call(c: Context, path: string, method: string, body?: unknown) {
  const r = await handleApi(
    new Request(`${ORIGIN}/api/${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
    c,
  );
  return { status: r.status, data: await r.json().catch(() => null) };
}

const options: ImapOptions = {
  host: "imap.example.vn",
  port: 993,
  secure: true,
  user: "bounce@example.vn",
  pass: "x",
  mailbox: "INBOX",
  intervalMs: 60_000,
  batch: 25,
};

const DSN = [
  "From: MAILER-DAEMON@example.vn",
  "",
  "Final-Recipient: rfc822; gone@example.com",
  "Action: failed",
  "Status: 5.1.1",
  "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
].join("\r\n");

const CHATTER = [
  "From: friend@example.com",
  "Subject: Lunch?",
  "",
  "Are we still on for Friday?",
].join("\r\n");

function fakeImap(messages: { uid: number; body: string }[]) {
  const seen = new Set<number>();
  const flags: string[] = [];
  // IMAP is single-command-at-a-time: issuing STORE while a FETCH response is
  // still streaming kills the connection on real servers, so the fake enforces
  // it too.
  let fetching = false;
  const client: ImapClient = {
    async connect() {},
    async logout() {},
    async getMailboxLock() {
      return { release() {} };
    },
    async search() {
      return messages.filter((m) => !seen.has(m.uid)).map((m) => m.uid);
    },
    async *fetch(range) {
      fetching = true;
      try {
        for (const uid of String(range).split(",").map(Number)) {
          const message = messages.find((m) => m.uid === uid);
          if (message) yield { uid, source: Buffer.from(message.body) };
        }
      } finally {
        fetching = false;
      }
    },
    async messageFlagsAdd(range) {
      if (fetching)
        throw new Error("Connection not available: STORE during FETCH");
      for (const uid of String(range).split(",").map(Number)) seen.add(uid);
      flags.push(String(range));
      return true;
    },
  };
  return { client, seen, flags };
}

test("imap: env parsing is strict and tolerant of defaults", () => {
  assert.equal(imapOptionsFromEnv({}), null);
  assert.equal(
    imapOptionsFromEnv({ BOUNCE_IMAP_HOST: "h", BOUNCE_IMAP_USER: "u" }),
    null,
  );
  const parsed = imapOptionsFromEnv({
    BOUNCE_IMAP_HOST: "imap.example.vn",
    BOUNCE_IMAP_USER: "bounce@example.vn",
    BOUNCE_IMAP_PASS: "secret",
  })!;
  assert.equal(parsed.port, 993);
  assert.equal(parsed.secure, true);
  assert.equal(parsed.mailbox, "INBOX");
  assert.equal(parsed.intervalMs, 60_000);
  const plain = imapOptionsFromEnv({
    BOUNCE_IMAP_HOST: "h",
    BOUNCE_IMAP_USER: "u",
    BOUNCE_IMAP_PASS: "p",
    BOUNCE_IMAP_PORT: "143",
    BOUNCE_IMAP_SECURE: "false",
    BOUNCE_IMAP_INTERVAL: "5",
    BOUNCE_IMAP_MAILBOX: "Bounces",
    BOUNCE_WORKSPACE: "w1",
  })!;
  assert.equal(plain.secure, false);
  assert.equal(plain.mailbox, "Bounces");
  assert.equal(plain.intervalMs, 15_000, "interval is clamped to 15s");
  assert.equal(plain.workspaceId, "w1");
});

test("imap: poll suppresses a hard bounce, ignores normal mail, does not replay", async () => {
  const { c, db } = fixture();
  const ws = await call(c, "workspaces", "POST", { name: "Nếp" });
  const w = ws.data.id as string;
  await call(c, `workspaces/${w}/contacts`, "POST", {
    email: "gone@example.com",
    name: "Gone",
    consent: true,
    consentSource: "Biểu mẫu",
  });

  const imap = fakeImap([
    { uid: 11, body: DSN },
    { uid: 12, body: CHATTER },
  ]);
  const logs: Record<string, unknown>[] = [];
  const poller = createBouncePoller({
    options,
    context: c,
    clientFactory: () => imap.client,
    log: (_line, detail) => logs.push(detail || {}),
  });

  const first = await poller.pollOnce();
  assert.deepEqual(first, { messages: 2, events: 1, suppressed: 1 });
  assert.equal(
    (
      db.raw
        .prepare("SELECT status,consent FROM contacts WHERE email=?")
        .get("gone@example.com") as any
    ).status,
    "suppressed",
  );
  assert.deepEqual(
    [...imap.seen].sort(),
    [11, 12],
    "both messages marked seen",
  );

  const second = await poller.pollOnce();
  assert.equal(second.messages, 0, "nothing replays after a restart");
  assert.equal(second.suppressed, 0);
  const audits = db.raw
    .prepare("SELECT action,detail FROM audit WHERE action='contact.bounce'")
    .all() as any[];
  assert.equal(audits.length, 1, "one audit row, not one per poll");
  assert.match(audits[0].detail, /gone@example\.com/);
});

test("imap: soft bounces do not suppress, connection errors do not throw", async () => {
  const { c, db } = fixture();
  const ws = await call(c, "workspaces", "POST", { name: "Nếp" });
  const w = ws.data.id as string;
  await call(c, `workspaces/${w}/contacts`, "POST", {
    email: "later@example.com",
    name: "Later",
    consent: true,
    consentSource: "Biểu mẫu",
  });
  const soft = DSN.replace("5.1.1", "4.4.1").replace(
    "Action: failed",
    "Action: delayed",
  );
  const imap = fakeImap([{ uid: 1, body: soft }]);
  const poller = createBouncePoller({
    options,
    context: c,
    clientFactory: () => imap.client,
  });
  const result = await poller.pollOnce();
  assert.equal(result.events, 1);
  assert.equal(result.suppressed, 0);
  assert.equal(
    (
      db.raw
        .prepare("SELECT status FROM contacts WHERE email=?")
        .get("later@example.com") as any
    ).status,
    "active",
  );

  const failing = createBouncePoller({
    options,
    context: c,
    clientFactory: () => ({
      connect: async () => {
        throw new Error("ECONNREFUSED");
      },
      logout: async () => {},
      getMailboxLock: async () => ({ release() {} }),
      search: async () => [],
      // eslint-disable-next-line require-yield
      async *fetch() {},
      messageFlagsAdd: async () => true,
    }),
    log: () => {},
  });
  const failed = await failing.pollOnce();
  assert.equal(failed.error, "ECONNREFUSED");
  assert.equal(failed.messages, 0);
});

test("imap: suppression is instance-wide unless a workspace is configured", async () => {
  const { c, db } = fixture();
  const a = (await call(c, "workspaces", "POST", { name: "Alpha" })).data
    .id as string;
  const b = (await call(c, "workspaces", "POST", { name: "Bravo" })).data
    .id as string;
  for (const w of [a, b])
    await call(c, `workspaces/${w}/contacts`, "POST", {
      email: "shared@example.com",
      name: "Shared",
      consent: true,
      consentSource: "Biểu mẫu",
    });

  const imap = fakeImap([{ uid: 5, body: DSN.replace("gone@", "shared@") }]);
  const poller = createBouncePoller({
    options,
    context: c,
    clientFactory: () => imap.client,
  });
  const result = await poller.pollOnce();
  assert.equal(
    result.suppressed,
    2,
    "same address suppressed in both workspaces",
  );
  const statuses = db.raw
    .prepare("SELECT status FROM contacts WHERE email=?")
    .all("shared@example.com") as any[];
  assert.deepEqual(
    statuses.map((row) => row.status),
    ["suppressed", "suppressed"],
  );

  // Scoped mode leaves other workspaces alone.
  const { c: c2, db: db2 } = fixture();
  const a2 = (await call(c2, "workspaces", "POST", { name: "Alpha" })).data
    .id as string;
  const b2 = (await call(c2, "workspaces", "POST", { name: "Bravo" })).data
    .id as string;
  for (const w of [a2, b2])
    await call(c2, `workspaces/${w}/contacts`, "POST", {
      email: "shared@example.com",
      name: "Shared",
      consent: true,
      consentSource: "Biểu mẫu",
    });
  const imap2 = fakeImap([{ uid: 9, body: DSN.replace("gone@", "shared@") }]);
  const scoped = createBouncePoller({
    options: { ...options, workspaceId: a2 },
    context: c2,
    clientFactory: () => imap2.client,
  });
  assert.equal((await scoped.pollOnce()).suppressed, 1);
  const statusOf = (workspaceId: string) =>
    (
      db2.raw
        .prepare("SELECT status FROM contacts WHERE workspace_id=? AND email=?")
        .get(workspaceId, "shared@example.com") as any
    ).status;
  assert.equal(statusOf(a2), "suppressed");
  assert.equal(
    statusOf(b2),
    "active",
    "scoped mode leaves other workspaces alone",
  );
});

test("imap: the real client exposes every method the poller calls", () => {
  // Contract test against the dependency: no connection is opened, but an
  // upgrade that renames search/fetch/messageFlagsAdd fails here instead of in
  // production.
  const client = new ImapFlow({
    host: "127.0.0.1",
    port: 993,
    secure: true,
    auth: { user: "bounce", pass: "x" },
    logger: false,
  });
  for (const method of [
    "connect",
    "logout",
    "getMailboxLock",
    "search",
    "fetch",
    "messageFlagsAdd",
  ])
    assert.equal(
      typeof (client as unknown as Record<string, unknown>)[method],
      "function",
      method,
    );
});
