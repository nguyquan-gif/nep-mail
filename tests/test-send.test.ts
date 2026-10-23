import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../selfhost/database.ts";
import { handleApi } from "../src/core/api.ts";
import { allowTestSend } from "../src/core/api.ts";
import type { Context } from "../src/core/types.ts";

function fixture(options: { live?: boolean; capture?: boolean } = {}) {
  const db = new SqliteDatabase(":memory:");
  db.migrate("drizzle");
  const sent: any[] = [];
  const c: Context = {
    db,
    user: { id: "u", email: "a@nep-mail.dev", name: "A" },
    config: {
      runtime: "selfhost",
      liveEnabled: options.live ?? true,
      captureAvailable: options.capture ?? false,
      sender: "mail@nep-mail.dev",
      unsubscribeSecret: "s".repeat(40),
      publicUnsubscribeOrigin: "https://mail.nep-mail.dev",
      transport: {
        async send(m) {
          sent.push(m);
          return { id: "accepted-1" };
        },
      },
    },
  };
  return { db, c, sent };
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

async function draftCampaign(c: Context) {
  const w = (await call(c, "workspaces", "POST", { name: "Workspace thử" }))
    .data.id;
  const id = (
    await call(c, `workspaces/${w}/campaigns`, "POST", {
      name: "Bản tin",
      subject: "Chào {{first_name}}",
      preheader: "Mở ra xem",
      body: "Chào {{name}},\n\nNội dung bản tin thử nghiệm.",
      category: "marketing",
      audienceTag: "",
    })
  ).data.id;
  return { w, id };
}

test("test send: delivers the campaign to whatever address is given", async () => {
  const { c, sent, db } = fixture();
  const { w, id } = await draftCampaign(c);

  const res = await call(c, `workspaces/${w}/campaigns/${id}/test`, "POST", {
    to: "boss@example.com",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(
    { mode: res.data.mode, to: res.data.to },
    { mode: "live", to: "boss@example.com" },
  );
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "boss@example.com");
  assert.match(sent[0].subject, /Chào/);
  assert.match(sent[0].html, /boss@example\.com|Bạn/);
  assert.match(sent[0].unsubscribe, /\/api\/unsubscribe\?token=/);

  // A test is not a delivery: no contact, no delivery row, no suppression.
  const contacts = db.raw
    .prepare("SELECT COUNT(*) AS n FROM contacts")
    .get() as {
    n: number;
  };
  const deliveries = db.raw
    .prepare("SELECT COUNT(*) AS n FROM deliveries")
    .get() as { n: number };
  assert.equal(contacts.n, 0);
  assert.equal(deliveries.n, 0);

  const audit = db.raw
    .prepare(
      "SELECT action,detail FROM audit WHERE action='campaign.test_sent'",
    )
    .all() as { action: string; detail: string }[];
  assert.equal(audit.length, 1);
  assert.match(audit[0].detail, /boss@example\.com/);
});

test("test send: rejects a malformed address and a missing sending path", async () => {
  const { c, sent } = fixture();
  const { w, id } = await draftCampaign(c);

  for (const to of ["", "not-an-email", "a@b", "x@y.z\n"]) {
    const res = await call(c, `workspaces/${w}/campaigns/${id}/test`, "POST", {
      to,
    });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(to)}`);
  }
  assert.equal(sent.length, 0);

  const off = fixture({ live: false, capture: false });
  const other = await draftCampaign(off.c);
  const res = await call(
    off.c,
    `workspaces/${other.w}/campaigns/${other.id}/test`,
    "POST",
    { to: "boss@example.com" },
  );
  assert.equal(res.status, 409);
  assert.equal(off.sent.length, 0);
});

test("test send: works in capture mode too, and is capped per workspace", async () => {
  const capture = fixture({ live: false, capture: true });
  const cap = await draftCampaign(capture.c);
  const first = await call(
    capture.c,
    `workspaces/${cap.w}/campaigns/${cap.id}/test`,
    "POST",
    { to: "boss@example.com" },
  );
  assert.equal(first.status, 200);
  assert.equal(first.data.mode, "capture");

  // Five sends per ten minutes, per workspace.
  const { c } = fixture();
  const { w, id } = await draftCampaign(c);
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) {
    codes.push(
      (
        await call(c, `workspaces/${w}/campaigns/${id}/test`, "POST", {
          to: `boss${i}@example.com`,
        })
      ).status,
    );
  }
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
});

test("test send: the throttle window expires", () => {
  const t0 = 1_000_000;
  const w = "workspace-window";
  for (let i = 0; i < 5; i++) assert.equal(allowTestSend(w, t0 + i), true);
  assert.equal(allowTestSend(w, t0 + 10), false);
  assert.equal(allowTestSend(w, t0 + 10 * 60_000 + 1), true);
});
