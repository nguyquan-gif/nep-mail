import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../selfhost/database.ts";
import { handleApi } from "../src/core/api.ts";
import {
  RelayError,
  relayEventsFromPayload,
  relayTransport,
  isRelayProvider,
} from "../src/core/relay.ts";
import type { Context } from "../src/core/types.ts";

const ORIGIN = "https://mail.nep-mail.dev";
const SECRET = "webhook-secret-for-tests-123456";

function fixture(options: { secret?: string } = {}) {
  const db = new SqliteDatabase(":memory:");
  db.migrate("drizzle");
  const c: Context = {
    db,
    user: { id: "u", email: "a@nep-mail.dev", name: "A" },
    config: {
      runtime: "test",
      liveEnabled: false,
      sender: "hello@nep-mail.dev",
      unsubscribeSecret: "s".repeat(40),
      publicUnsubscribeOrigin: ORIGIN,
      relayWebhookSecret: options.secret ?? SECRET,
      transport: {
        async send() {
          return { id: "x" };
        },
      },
    },
  };
  return { db, c };
}

const mail = {
  to: "reader@example.com",
  subject: "Bản tin tháng 10",
  html: "<p>Hello</p>",
  text: "Hello",
  unsubscribe: "https://mail.nep-mail.dev/api/unsubscribe?token=abc",
  idempotencyKey: "delivery-1",
};

test("relay: Brevo request is built with sender, content and opt-out headers", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = relayTransport({
    provider: "brevo",
    apiKey: "xkeysib-test",
    sender: { email: "hello@nep-mail.dev", name: "Nếp Mail" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({ messageId: "<abc@brevo>" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await transport.send(mail);
  assert.deepEqual(result, { id: "<abc@brevo>" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["api-key"], "xkeysib-test");
  assert.match(headers["content-type"], /application\/json/);

  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.sender, {
    email: "hello@nep-mail.dev",
    name: "Nếp Mail",
  });
  assert.deepEqual(body.to, [{ email: "reader@example.com" }]);
  assert.equal(body.subject, mail.subject);
  assert.equal(body.htmlContent, mail.html);
  assert.equal(body.textContent, mail.text);
  assert.equal(body.headers["List-Unsubscribe"], `<${mail.unsubscribe}>`);
  assert.equal(
    body.headers["List-Unsubscribe-Post"],
    "List-Unsubscribe=One-Click",
  );
  assert.equal(body.headers.IdempotencyKey, "delivery-1");
  assert.ok(
    !String(calls[0].init.body).includes("xkeysib-test"),
    "key never goes in the body",
  );
});

test("relay: provider errors surface status without leaking the key", async () => {
  const transport = relayTransport({
    provider: "brevo",
    apiKey: "xkeysib-secret-value",
    sender: { email: "hello@nep-mail.dev" },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ code: "unauthorized", message: "Key not found" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
  });
  await assert.rejects(
    () => transport.send(mail),
    (error: unknown) => {
      assert.ok(error instanceof RelayError);
      assert.equal((error as RelayError).status, 401);
      assert.match((error as Error).message, /Key not found/);
      assert.ok(!(error as Error).message.includes("xkeysib-secret-value"));
      return true;
    },
  );

  const accepted = relayTransport({
    provider: "brevo",
    apiKey: "k",
    sender: { email: "hello@nep-mail.dev" },
    fetchImpl: async () => new Response("", { status: 202 }),
  });
  assert.deepEqual(await accepted.send(mail), { id: "relay-accepted" });
});

test("relay: webhook payloads map to hard, soft and complaint events only", () => {
  assert.ok(isRelayProvider("brevo"));
  assert.equal(isRelayProvider("mailchimp"), false);

  const single = relayEventsFromPayload("brevo", {
    event: "hard_bounce",
    email: "Gone@Example.COM",
    reason: "550 5.1.1 user unknown",
  });
  assert.deepEqual(single, [
    {
      email: "gone@example.com",
      kind: "hard",
      diagnostic: "550 5.1.1 user unknown",
    },
  ]);

  const batch = relayEventsFromPayload("brevo", {
    items: [
      {
        event: "soft_bounce",
        email: "later@example.com",
        reason: "mailbox full",
      },
      { event: "spam", email: "angry@example.com", reason: "marked as spam" },
      { event: "delivered", email: "ok@example.com" },
      { event: "unsubscribed", email: "bye@example.com" },
      { event: "blocked", email: "blocked@example.com" },
      { event: "invalid", email: "bad@example.com" },
      { event: "error", email: "err@example.com" },
      { event: "hard_bounce" },
    ],
  });
  assert.deepEqual(
    batch.map((event) => `${event.email}:${event.kind}`),
    [
      "later@example.com:soft",
      "angry@example.com:complaint",
      "blocked@example.com:hard",
      "bad@example.com:hard",
      "err@example.com:soft",
    ],
  );

  assert.deepEqual(
    relayEventsFromPayload("brevo", [{ event: "hard_bounce", email: "a@b.vn" }])
      .length,
    1,
  );
  assert.deepEqual(relayEventsFromPayload("brevo", { nothing: true }), []);

  // Brevo's documented event names are camelCase, not snake_case.
  const camel = relayEventsFromPayload("brevo", {
    items: [
      { event: "hardBounce", email: "dead@example.com", reason: "550 5.1.1" },
      {
        event: "softBounce",
        email: "full@example.com",
        reason: "mailbox full",
      },
      { event: "delivered", email: "ok@example.com" },
    ],
  });
  assert.deepEqual(
    camel.map((event) => `${event.email}:${event.kind}`),
    ["dead@example.com:hard", "full@example.com:soft"],
  );
});

async function webhook(
  c: Context,
  token: string,
  payload: unknown,
  provider = "brevo",
) {
  const response = await handleApi(
    new Request(
      `${ORIGIN}/api/v1/webhooks/${provider}?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
    c,
  );
  return {
    status: response.status,
    data: await response.json().catch(() => null),
  };
}

test("relay webhook: shared secret, suppression and no contact creation", async () => {
  const { c, db } = fixture();
  const ws = await handleApi(
    new Request(`${ORIGIN}/api/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nếp" }),
    }),
    c,
  );
  const w = ((await ws.json()) as { id: string }).id;
  await handleApi(
    new Request(`${ORIGIN}/api/workspaces/${w}/contacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "gone@example.com",
        name: "Gone",
        consent: true,
        consentSource: "Biểu mẫu",
      }),
    }),
    c,
  );

  const before = db.raw.prepare("SELECT COUNT(*) AS n FROM contacts").get() as {
    n: number;
  };

  assert.equal(
    (
      await webhook(c, "wrong-secret", {
        event: "hard_bounce",
        email: "x@y.vn",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await webhook(
        c,
        SECRET,
        { event: "hard_bounce", email: "x@y.vn" },
        "mailjet",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await webhook(c, SECRET, {
        event: "delivered",
        email: "gone@example.com",
      })
    ).status,
    200,
  );

  const ok = await webhook(c, SECRET, [
    { event: "hard_bounce", email: "gone@example.com", reason: "550 5.1.1" },
    { event: "hard_bounce", email: "never-seen@example.com", reason: "550" },
  ]);
  assert.equal(ok.status, 200);
  assert.deepEqual(
    ok.data,
    { received: 2, suppressed: 1 },
    "only the known contact is suppressed",
  );

  const after = db.raw.prepare("SELECT COUNT(*) AS n FROM contacts").get() as {
    n: number;
  };
  assert.equal(after.n, before.n, "a webhook cannot create contacts");

  const row = db.raw
    .prepare("SELECT status,consent FROM contacts WHERE email=?")
    .get("gone@example.com") as { status: string; consent: number };
  assert.equal(row.status, "suppressed");
  assert.equal(row.consent, 0);

  const audit = db.raw
    .prepare("SELECT actor,detail FROM audit WHERE action='contact.bounce'")
    .all() as { actor: string; detail: string }[];
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor, "relay:brevo");
});

test("relay webhook: refuses to run without a configured secret", async () => {
  const { c } = fixture({ secret: "" });
  const response = await webhook(c, "", {
    event: "hard_bounce",
    email: "a@b.vn",
  });
  assert.equal(response.status, 503);
});
