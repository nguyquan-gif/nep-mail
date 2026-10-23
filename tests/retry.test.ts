import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../selfhost/database.ts";
import { handleApi, applyBounceEvents } from "../src/core/api.ts";
import type { Context } from "../src/core/types.ts";

function fixture() {
  const db = new SqliteDatabase(":memory:");
  db.migrate("drizzle");
  const state = { fail: false, sent: [] as any[] };
  const c: Context = {
    db,
    user: { id: "u", email: "a@nep-mail.dev", name: "A" },
    config: {
      runtime: "selfhost",
      liveEnabled: true,
      captureAvailable: false,
      sender: "mail@nep-mail.dev",
      unsubscribeSecret: "s".repeat(40),
      publicUnsubscribeOrigin: "https://mail.nep-mail.dev",
      transport: {
        async send(mail) {
          if (state.fail) throw new Error("relay 500: upstream unavailable");
          state.sent.push(mail);
          return { id: "accepted-" + state.sent.length };
        },
      },
    },
  };
  return { db, c, state };
}

async function call(c: Context, path: string, method = "GET", body?: unknown) {
  const r = await handleApi(
    new Request("https://mail.nep-mail.dev/api/" + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
    c,
  );
  const text = await r.text();
  return {
    status: r.status,
    data: r.headers.get("content-type")?.includes("json")
      ? JSON.parse(text)
      : text,
  };
}

async function seed(c: Context) {
  const w = (await call(c, "workspaces", "POST", { name: "Workspace thử" }))
    .data.id;
  await call(c, `workspaces/${w}/contacts`, "POST", {
    email: "reader@example.com",
    name: "Nguyễn Minh Anh",
    tags: "tin",
    consent: true,
    consentSource: "Biểu mẫu",
  });
  const id = (
    await call(c, `workspaces/${w}/campaigns`, "POST", {
      name: "Bản tin",
      subject: "Chào {{first_name}}",
      preheader: "",
      body: "Chào {{name}},\n\nNội dung.",
      category: "marketing",
      audienceTag: "tin",
    })
  ).data.id;
  return { w, id };
}

test("retry: a failed delivery can be re-queued and delivered", async () => {
  const { c, state, db } = fixture();
  const { w, id } = await seed(c);

  await call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {});
  state.fail = true;
  const first = await call(
    c,
    `workspaces/${w}/campaigns/${id}/process`,
    "POST",
    {},
  );
  assert.equal(first.data.processed, 1);
  const failed = db.raw
    .prepare("SELECT status,error FROM deliveries WHERE campaign_id=?")
    .get(id) as { status: string; error: string };
  assert.equal(failed.status, "unknown");
  assert.ok(failed.error && failed.error.length > 0, "the failure is recorded");

  // Nothing to retry on a campaign that never failed.
  const none = await call(
    c,
    `workspaces/${w}/campaigns/${id}/retry`,
    "POST",
    {},
  );
  assert.equal(none.status, 200);
  assert.equal(none.data.queued, 1);
  const again = await call(
    c,
    `workspaces/${w}/campaigns/${id}/retry`,
    "POST",
    {},
  );
  assert.equal(again.data.queued, 0);

  state.fail = false;
  const processed = await call(
    c,
    `workspaces/${w}/campaigns/${id}/process`,
    "POST",
    {},
  );
  assert.equal(processed.data.processed, 1);
  const row = db.raw
    .prepare(
      "SELECT status,error,provider_id FROM deliveries WHERE campaign_id=?",
    )
    .get(id) as { status: string; error: string | null; provider_id: string };
  assert.equal(row.status, "accepted");
  assert.equal(row.error, null);
  assert.equal(row.provider_id, "accepted-1");
  assert.equal(state.sent.length, 1);

  const audit = db.raw
    .prepare("SELECT detail FROM audit WHERE action='campaign.retried'")
    .all() as { detail: string }[];
  assert.equal(audit.length, 1);
  assert.match(audit[0].detail, /1 thư lỗi/);
});

test("retry: refuses a draft campaign and a missing transport", async () => {
  const { c } = fixture();
  const { w, id } = await seed(c);
  const draft = await call(
    c,
    `workspaces/${w}/campaigns/${id}/retry`,
    "POST",
    {},
  );
  assert.equal(draft.status, 409);

  const bare = fixture();
  bare.c.config.transport = undefined;
  const other = await seed(bare.c);
  await call(
    bare.c,
    `workspaces/${other.w}/campaigns/${other.id}/queue`,
    "POST",
    {},
  );
  const res = await call(
    bare.c,
    `workspaces/${other.w}/campaigns/${other.id}/retry`,
    "POST",
    {},
  );
  assert.equal(res.status, 409);
});

test("suppression: a suppressed contact carries the reason that stopped it", async () => {
  const { c } = fixture();
  const { w } = await seed(c);
  await applyBounceEvents(
    c,
    [
      {
        email: "reader@example.com",
        kind: "hard",
        status: "550",
        diagnostic: "550 5.1.1 user unknown",
      },
    ],
    w,
    "test",
  );

  const view = await call(c, `workspaces/${w}`);
  const contact = (view.data.contacts as any[]).find(
    (x) => x.email === "reader@example.com",
  );
  assert.equal(contact.status, "suppressed");
  assert.equal(contact.consent, 0);
  assert.match(contact.suppressed_reason, /user unknown/);
});
