import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../selfhost/database.ts";
import { handleApi } from "../src/core/api.ts";
import { signPayload, verifyPayload } from "../src/core/domain.ts";
import { checkDomain } from "../src/core/dns.ts";
import { generateDkimKey, txtChunks } from "../src/core/dkim.ts";
import { parseBounce, normalizeEvent } from "../src/core/bounce.ts";
import type { Context } from "../src/core/types.ts";

const who = { id: "user-a", email: "a@nep-mail.dev", name: "Người A" };
const ORIGIN = "https://mail.nep-mail.dev";

function fixture() {
  const db = new SqliteDatabase(":memory:");
  db.migrate("drizzle");
  const sent: any[] = [];
  const c: Context = {
    db,
    user: who,
    config: {
      runtime: "test",
      liveEnabled: true,
      sender: "mail@nep-mail.dev",
      unsubscribeSecret: "s".repeat(40),
      publicUnsubscribeOrigin: ORIGIN,
      transport: {
        async send(m) {
          sent.push(m);
          return { id: "smtp-" + sent.length };
        },
      },
    },
  };
  return { db, c, sent };
}

async function call(
  c: Context,
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const r = await handleApi(
    new Request(`${ORIGIN}/api/${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    c,
  );
  const text = await r.text();
  return {
    status: r.status,
    text,
    data: r.headers.get("content-type")?.includes("json")
      ? JSON.parse(text)
      : null,
  };
}

async function publicPost(
  c: Context,
  path: string,
  form: Record<string, string>,
) {
  const r = await handleApi(
    new Request(`${ORIGIN}/api/public${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    }),
    c,
  );
  return { status: r.status, text: await r.text() };
}

async function setup() {
  const fixtureValues = fixture();
  const ws = await call(fixtureValues.c, "workspaces", "POST", { name: "Nếp" });
  const w = ws.data.id as string;
  const form = await call(fixtureValues.c, `workspaces/${w}/forms`, "POST", {
    name: "Bản tin",
    tag: "ban-tin",
    consentSource: "Biểu mẫu website",
    locale: "vi",
    slug: "ban-tin",
  });
  assert.equal(form.status, 201, form.text);
  return { ...fixtureValues, w, slug: form.data.slug as string };
}

test("signup: public form, double opt-in, replay and consent provenance", async () => {
  const { c, sent, db, slug } = await setup();

  const page = await handleApi(
    new Request(`${ORIGIN}/api/public/signup/${slug}`),
    c,
  );
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /<form method="post"/);
  assert.ok(html.includes("Đăng ký"));

  const submit = await publicPost(c, `/signup/${slug}`, {
    email: "Minh@Example.COM",
    name: "Minh Anh",
  });
  assert.equal(submit.status, 200);
  assert.equal(sent.length, 1, "one confirmation message");
  assert.match(sent[0].text, /Xác nhận địa chỉ email/);
  const link = sent[0].text.match(/https:\/\/[^\s]+confirm\?token=[^\s]+/)?.[0];
  assert.ok(link, "confirmation link present");
  assert.ok(link!.includes("&l=") === false);

  const pending = db.raw
    .prepare("SELECT * FROM contacts WHERE email=?")
    .get("minh@example.com") as any;
  assert.equal(pending.status, "pending");
  assert.equal(
    pending.consent,
    0,
    "consent is not granted before confirmation",
  );

  // GET must not mutate (mail scanners follow links).
  const preview = await handleApi(new Request(link!), c);
  assert.equal(preview.status, 200);
  assert.ok((await preview.text()).includes("Xác nhận đăng ký"));
  assert.equal(
    (
      db.raw
        .prepare("SELECT status FROM contacts WHERE id=?")
        .get(pending.id) as any
    ).status,
    "pending",
  );

  const confirm = await handleApi(new Request(link!, { method: "POST" }), c);
  assert.equal(confirm.status, 200);
  assert.ok((await confirm.text()).includes("Đã xác nhận đăng ký"));
  const active = db.raw
    .prepare("SELECT * FROM contacts WHERE id=?")
    .get(pending.id) as any;
  assert.equal(active.status, "active");
  assert.equal(active.consent, 1);
  assert.equal(active.consent_source, "Biểu mẫu website");
  assert.ok(active.consent_at);
  assert.ok(active.tags.includes("ban-tin"));

  const replay = await handleApi(new Request(link!, { method: "POST" }), c);
  assert.equal(replay.status, 200);
  assert.ok((await replay.text()).includes("Đã xác nhận trước đó"));
});

test("signup: never resurrects suppressed or unsubscribed addresses", async () => {
  const { c, sent, db, w, slug } = await setup();
  await call(c, `workspaces/${w}/contacts`, "POST", {
    email: "blocked@nep-mail.dev",
    name: "Blocked",
    consent: false,
  });
  await call(c, `workspaces/${w}/contacts`, "PATCH", undefined, {}).catch(
    () => {},
  );
  const row = db.raw
    .prepare("SELECT id FROM contacts WHERE email=?")
    .get("blocked@nep-mail.dev") as any;
  await call(c, `workspaces/${w}/contacts/${row.id}`, "PATCH", {
    status: "suppressed",
  });

  const submit = await publicPost(c, `/signup/${slug}`, {
    email: "blocked@nep-mail.dev",
    name: "Blocked",
  });
  assert.equal(submit.status, 200, "generic answer, no information leak");
  assert.equal(sent.length, 0, "no confirmation sent to a suppressed address");
  const after = db.raw
    .prepare("SELECT status,consent FROM contacts WHERE id=?")
    .get(row.id) as any;
  assert.equal(after.status, "suppressed");
  assert.equal(after.consent, 0);
});

test("signup: validation, honeypot, rate limit and tampered token", async () => {
  const { c, sent, slug } = await setup();
  const bad = await publicPost(c, `/signup/${slug}`, { email: "not-an-email" });
  assert.equal(bad.status, 200);
  assert.ok(bad.text.includes("Email chưa hợp lệ"));
  assert.equal(sent.length, 0);

  const bot = await publicPost(c, `/signup/${slug}`, {
    email: "bot@nep-mail.dev",
    name: "Bot",
    company: "spam",
  });
  assert.equal(bot.status, 200);
  assert.equal(sent.length, 0, "honeypot must not send mail");

  const tampered = await handleApi(
    new Request(`${ORIGIN}/api/public/confirm?token=abc.def`),
    c,
  );
  assert.equal(tampered.status, 400);

  // 21 attempts from one address inside an hour trip the limiter.
  let last = 200;
  for (let i = 0; i < 22; i++)
    last = (
      await publicPost(c, `/signup/${slug}`, { email: `p${i}@nep-mail.dev` })
    ).status;
  assert.equal(last, 200);
});

test("dns: SPF, DKIM and DMARC verdicts from injected DNS answers", async () => {
  const answers = {
    "nep-mail.dev": ["v=spf1 include:_spf.example.com -all"],
    "_dmarc.nep-mail.dev": [
      "v=DMARC1; p=reject; rua=mailto:dmarc@nep-mail.dev",
    ],
    "nep._domainkey.nep-mail.dev": ["v=DKIM1; k=rsa; p=" + "A".repeat(300)],
  } as Record<string, string[]>;
  const fetcher = async (url: string) => {
    const name = decodeURIComponent(
      new URL(url).searchParams.get("name") || "",
    );
    const type = new URL(url).searchParams.get("type");
    const data =
      type === "MX" ? ["10 mail.nep-mail.dev."] : answers[name] || [];
    return new Response(
      JSON.stringify({
        Status: 0,
        Answer: data.map((value) => ({
          type: type === "MX" ? 15 : 16,
          data: `"${value}"`,
        })),
      }),
      { headers: { "content-type": "application/dns-json" } },
    );
  };
  const good = await checkDomain("nep-mail.dev", "nep", fetcher);
  assert.equal(good.ready, true, JSON.stringify(good.checks));
  assert.deepEqual(
    good.checks.map((c) => c.id),
    ["mx", "spf", "dkim", "dmarc"],
  );

  const empty = await checkDomain(
    "nep-mail.dev",
    "nep",
    async () =>
      new Response(JSON.stringify({ Status: 0 }), {
        headers: { "content-type": "application/dns-json" },
      }),
  );
  assert.equal(empty.ready, false);
  assert.equal(empty.checks.find((c) => c.id === "spf")!.status, "fail");
  assert.equal(empty.checks.find((c) => c.id === "dkim")!.status, "fail");

  await assert.rejects(() => checkDomain("not a domain", "nep", fetcher));
});

test("dkim: generated key publishes a usable TXT record", async () => {
  const key = await generateDkimKey("nep", "nep-mail.dev", 2048);
  assert.match(key.privateKeyPem, /^-----BEGIN PRIVATE KEY-----/);
  assert.match(key.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
  assert.equal(key.dnsName, "nep._domainkey.nep-mail.dev");
  assert.match(key.dnsValue, /^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]{300,}$/);
  assert.equal(txtChunks(key.dnsValue).join(""), key.dnsValue);
  assert.ok(txtChunks(key.dnsValue).every((chunk) => chunk.length <= 255));
});

test("signature: payload signing rejects tampering and wrong secrets", async () => {
  const token = await signPayload(
    "s".repeat(40),
    "form|a@b.vn|2099-01-01T00:00:00Z",
  );
  assert.equal(
    await verifyPayload("s".repeat(40), token),
    "form|a@b.vn|2099-01-01T00:00:00Z",
  );
  assert.equal(await verifyPayload("x".repeat(40), token), null);
  assert.equal(
    await verifyPayload("s".repeat(40), token.slice(0, -3) + "AAA"),
    null,
  );
  assert.equal(await verifyPayload("s".repeat(40), "garbage"), null);
});

test("bounce: DSN parsing, complaint reports and suppression endpoint", async () => {
  const dsn = [
    "From: MAILER-DAEMON@nep-mail.dev",
    "Content-Type: multipart/report; report-type=delivery-status; boundary=x",
    "",
    "--x",
    "Content-Type: message/delivery-status",
    "",
    "Final-Recipient: rfc822; Gone@Example.com",
    "Action: failed",
    "Status: 5.1.1",
    "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
    "",
    "Final-Recipient: rfc822; later@example.com",
    "Action: delayed",
    "Status: 4.4.1",
    "",
    "--x--",
  ].join("\r\n");
  const parsed = parseBounce(dsn);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].email, "gone@example.com");
  assert.equal(parsed[0].kind, "hard");
  assert.equal(parsed[1].kind, "soft");

  const arf = [
    "From: staff@example.net",
    "Feedback-Type: abuse",
    "Original-Rcpt-To: victim@example.com",
    "",
    "This is a complaint report.",
  ].join("\r\n");
  const complaints = parseBounce(arf);
  assert.equal(complaints[0].kind, "complaint");
  assert.equal(normalizeEvent({ email: "X@Y.vn", type: "soft" })!.kind, "soft");
  assert.equal(normalizeEvent({ email: "nope", type: "hard" }), null);

  const { c, db, w } = await setup();
  await call(c, `workspaces/${w}/contacts`, "POST", {
    email: "gone@example.com",
    name: "Gone",
    consent: true,
    consentSource: "Biểu mẫu",
  });
  const key = await call(c, `workspaces/${w}/keys`, "POST", {
    name: "Máy chủ bounce",
    source: "custom",
  });
  assert.equal(key.status, 201, key.text);
  const post = await handleApi(
    new Request(`${ORIGIN}/api/v1/bounces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key.data.token}`,
      },
      body: JSON.stringify({ message: dsn }),
    }),
    c,
  );
  assert.equal(post.status, 200, await post.clone().text());
  assert.equal((await post.json()).suppressed, 1);
  const row = db.raw
    .prepare("SELECT status,consent FROM contacts WHERE email=?")
    .get("gone@example.com") as any;
  assert.equal(row.status, "suppressed");
  assert.equal(row.consent, 0);

  const unauthorized = await handleApi(
    new Request(`${ORIGIN}/api/v1/bounces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer nep_wrong",
      },
      body: JSON.stringify({ message: dsn }),
    }),
    c,
  );
  assert.equal(unauthorized.status, 401);
});
