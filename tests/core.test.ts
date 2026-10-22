import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../selfhost/database.ts";
import { handleApi, processCampaign } from "../src/core/api.ts";
import {
  parseCsv,
  importContacts,
  renderEmail,
  unsubscribeToken,
  verifyUnsubscribe,
} from "../src/core/domain.ts";
import type { Context } from "../src/core/types.ts";
const who = { id: "user-a", email: "a@nep-mail.dev", name: "Người A" };
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
      publicUnsubscribeOrigin: "https://mail.nep-mail.dev",
      transport: {
        async send(m) {
          sent.push(m);
          return { id: "smtp-accepted" };
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
    new Request("https://mail.nep-mail.dev/api/" + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    c,
  );
  const s = await r.text();
  return {
    status: r.status,
    data: r.headers.get("content-type")?.includes("json") ? JSON.parse(s) : s,
  };
}
async function workspace(c: Context) {
  return (await call(c, "workspaces", "POST", { name: "Workspace thử" })).data
    .id;
}
const person = (email = "person@nep-mail.dev", consent = true) => ({
  email,
  name: "Nguyễn Minh Anh",
  tags: "khach-hang",
  consent,
  consentSource: consent ? "Đăng ký có xác nhận" : "",
});
const draft = {
  name: "Bản tin tháng",
  subject: "Chào {{first_name}}",
  body: "Chào {{name}},\n\nNội dung bản tin thử nghiệm.",
  category: "marketing",
  audienceTag: "khach-hang",
};
async function campaign(c: Context, w: string) {
  return (await call(c, `workspaces/${w}/campaigns`, "POST", draft)).data.id;
}
test("anonymous access rejected; browser cross-origin writes rejected", async () => {
  const { c } = fixture();
  assert.equal((await call({ ...c, user: null }, "bootstrap")).status, 401);
  assert.equal(
    (
      await call(
        c,
        "workspaces",
        "POST",
        { name: "hijack" },
        { origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
});
test("workspace isolation, viewer write denial and editor admin denial", async () => {
  const { c, db } = fixture(),
    w = await workspace(c);
  assert.equal(
    (
      await call(
        { ...c, user: { ...who, email: "other@nep-mail.dev" } },
        `workspaces/${w}`,
      )
    ).status,
    404,
  );
  await call(c, `workspaces/${w}/members`, "POST", {
    email: "view@nep-mail.dev",
    role: "viewer",
  });
  const viewer = { ...c, user: { ...who, email: "view@nep-mail.dev" } };
  assert.equal((await call(viewer, `workspaces/${w}`)).status, 200);
  assert.equal(
    (await call(viewer, `workspaces/${w}/contacts`, "POST", person())).status,
    403,
  );
  await call(c, `workspaces/${w}/members`, "POST", {
    email: "edit@nep-mail.dev",
    role: "editor",
  });
  const editor = { ...c, user: { ...who, email: "edit@nep-mail.dev" } };
  assert.equal(
    (await call(editor, `workspaces/${w}/contacts`, "POST", person())).status,
    200,
  );
  assert.equal(
    (
      await call(editor, `workspaces/${w}/keys`, "POST", {
        name: "key",
        source: "custom",
      })
    ).status,
    403,
  );
  db.close();
});
test("CSV quoted fields, BOM and all-or-nothing validation", () => {
  assert.deepEqual(parseCsv('\uFEFFemail,name\r\na@b.vn,"A, B"'), [
    ["email", "name"],
    ["a@b.vn", "A, B"],
  ]);
  assert.throws(() => parseCsv('email,name\na@b.vn,"unfinished'));
  assert.throws(() => importContacts("email,name,consent\na@b.vn,A,yes"));
  assert.equal(
    importContacts("email,name,consent,consent_source\na@b.vn,A,true,Form")[0]
      .consent,
    true,
  );
});
test("import replay preserves unsubscribe and requires consent provenance", async () => {
  const { c } = fixture(),
    w = await workspace(c);
  assert.equal(
    (
      await call(c, `workspaces/${w}/contacts`, "POST", {
        ...person(),
        consentSource: "",
      })
    ).status,
    400,
  );
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  const get = await call(c, `workspaces/${w}`),
    id = get.data.contacts[0].id;
  await call(c, `workspaces/${w}/contacts/${id}`, "PATCH", {
    status: "unsubscribed",
  });
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  const p = (await call(c, `workspaces/${w}`)).data.contacts[0];
  assert.equal(p.status, "unsubscribed");
  assert.equal(p.consent, 0);
  assert.equal(
    (
      await call(c, `workspaces/${w}/contacts/import`, "POST", {
        csv: "email,name\nbad,B\nvalid@nep-mail.dev,A",
      })
    ).status,
    400,
  );
  assert.equal((await call(c, `workspaces/${w}`)).data.contacts.length, 1);
});
test("HTML and personalized subject escape untrusted input", () => {
  const r = renderEmail(
    {
      subject: "Hello {{name}}",
      body: "<img src=x onerror=alert(1)> {{name}}",
    },
    { name: "<script>\r\nx", email: "a@b.vn" },
    "<Brand>",
    'https://mail.nep-mail.dev/?a="',
  );
  assert.ok(!r.html.includes("<script>"));
  assert.ok(!r.html.includes("<img"));
  assert.ok(r.html.includes("&lt;Brand&gt;"));
  assert.ok(!r.subject.includes("\n"));
});
test("preflight consent, immutable snapshot and duplicate queue prevention", async () => {
  const { c, db } = fixture(),
    w = await workspace(c);
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  await call(
    c,
    `workspaces/${w}/contacts`,
    "POST",
    person("no@nep-mail.dev", false),
  );
  const id = await campaign(c, w);
  const pre = await call(c, `workspaces/${w}/campaigns/${id}/preflight`);
  assert.equal(pre.data.eligible, 1);
  assert.equal(pre.data.excluded, 1);
  const responses = await Promise.all([
    call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {}),
    call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {}),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM deliveries").first())!.n,
    1,
  );
  assert.equal(
    (await call(c, `workspaces/${w}/campaigns/${id}`, "PATCH", draft)).status,
    409,
  );
});
test("due processing checks suppression at send time and does not send twice", async () => {
  const { c, sent } = fixture(),
    w = await workspace(c);
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  const id = await campaign(c, w);
  await call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {});
  await Promise.allSettled([
    processCampaign(c, w, id),
    processCampaign(c, w, id),
  ]);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].html.includes("Ngừng nhận email"));
  assert.ok(sent[0].text);
});
test("newly unsubscribed and synthetic contacts are skipped", async () => {
  const { c, sent } = fixture(),
    w = await workspace(c);
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  await call(
    c,
    `workspaces/${w}/contacts`,
    "POST",
    person("demo@example.invalid"),
  );
  const id = await campaign(c, w);
  await call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {});
  const p = (await call(c, `workspaces/${w}`)).data.contacts.find(
    (x: any) => x.email === "person@nep-mail.dev",
  );
  await call(c, `workspaces/${w}/contacts/${p.id}`, "PATCH", {
    status: "unsubscribed",
  });
  await processCampaign(c, w, id);
  assert.equal(sent.length, 0);
});
test("scheduled messages wait; cancellation skips pending deliveries", async () => {
  const { c, sent } = fixture(),
    w = await workspace(c);
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  const id = await campaign(c, w);
  await call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {
    scheduledAt: "2099-01-01T00:00:00Z",
  });
  await assert.rejects(() => processCampaign(c, w, id));
  await call(c, `workspaces/${w}/campaigns/${id}/cancel`, "POST", {});
  await assert.rejects(() => processCampaign(c, w, id));
  assert.equal(sent.length, 0);
});
test("ambiguous SMTP result is not automatically retried", async () => {
  const { c, db } = fixture(),
    w = await workspace(c);
  let attempts = 0;
  c.config.transport = {
    async send() {
      attempts++;
      throw new Error("timeout");
    },
  };
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  const id = await campaign(c, w);
  await call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {});
  await processCampaign(c, w, id);
  assert.equal(attempts, 1);
  assert.equal(
    (await db.prepare("SELECT status FROM deliveries").first())!.status,
    "unknown",
  );
});
test("live-send default gate blocks execution", async () => {
  const { c, sent } = fixture(),
    w = await workspace(c);
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  const id = await campaign(c, w);
  await call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {});
  c.config.liveEnabled = false;
  await assert.rejects(() => processCampaign(c, w, id));
  assert.equal(sent.length, 0);
});
test("signed unsubscribe GET is harmless; POST changes contact; tampering fails", async () => {
  const { c } = fixture(),
    w = await workspace(c);
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  const p = (await call(c, `workspaces/${w}`)).data.contacts[0];
  const token = await unsubscribeToken(c.config.unsubscribeSecret!, w, p.id);
  assert.ok(await verifyUnsubscribe(c.config.unsubscribeSecret!, token));
  assert.equal(await verifyUnsubscribe("wrong", token), null);
  assert.equal((await call(c, "unsubscribe?token=" + token)).status, 200);
  assert.equal(
    (await call(c, `workspaces/${w}`)).data.contacts[0].status,
    "active",
  );
  assert.equal(
    (await call({ ...c, user: null }, "unsubscribe?token=" + token, "POST"))
      .status,
    200,
  );
  assert.equal(
    (await call(c, `workspaces/${w}`)).data.contacts[0].status,
    "unsubscribed",
  );
});
test("integration tokens hashed, scoped, replay-safe and revocable; consent never granted", async () => {
  const { c, db } = fixture(),
    w = await workspace(c);
  const key = await call(c, `workspaces/${w}/keys`, "POST", {
    name: "Nếp HR",
    source: "nep_hr",
  });
  const stored = await db.prepare("SELECT * FROM integration_keys").first();
  assert.notEqual(stored!.digest, key.data.token);
  const headers = { authorization: "Bearer " + key.data.token };
  const event = {
    id: "hr-001",
    type: "contact.upsert",
    contact: { ...person(), consent: true },
  };
  const r = await call(
    { ...c, user: null },
    "v1/events",
    "POST",
    event,
    headers,
  );
  assert.equal(r.status, 200);
  assert.equal((await call(c, `workspaces/${w}`)).data.contacts[0].consent, 0);
  assert.equal(
    (await call(c, "v1/events", "POST", event, headers)).data.duplicate,
    true,
  );
  await call(c, `workspaces/${w}/keys/${stored!.id}`, "DELETE");
  assert.equal(
    (await call(c, "v1/events", "POST", { ...event, id: "hr-002" }, headers))
      .status,
    401,
  );
});
test("SQL injection is treated as plain data", async () => {
  const { c } = fixture(),
    w = await workspace(c);
  await call(c, `workspaces/${w}/contacts`, "POST", {
    ...person(),
    name: "Robert'); DROP TABLE contacts;--",
  });
  assert.equal((await call(c, `workspaces/${w}`)).data.contacts.length, 1);
});
test("unsubscribe before contact creation persists through later integration upsert", async () => {
  const { c } = fixture(),
    w = await workspace(c);
  const { data: key } = await call(c, `workspaces/${w}/keys`, "POST", {
    name: "Business key",
    source: "nep_business",
  });
  const headers = { authorization: "Bearer " + key.token };
  await call(
    { ...c, user: null },
    "v1/events",
    "POST",
    {
      id: "stop-1",
      type: "contact.unsubscribe",
      contact: { email: "late@nep-mail.dev", name: "Late contact" },
    },
    headers,
  );
  await call(
    { ...c, user: null },
    "v1/events",
    "POST",
    {
      id: "create-2",
      type: "contact.upsert",
      contact: { email: "late@nep-mail.dev", name: "Late contact" },
    },
    headers,
  );
  assert.equal(
    (await call(c, `workspaces/${w}`)).data.contacts[0].status,
    "unsubscribed",
  );
});
test("concurrent content edit invalidates queue snapshot instead of mixing revisions", async () => {
  const { c, db } = fixture(),
    w = await workspace(c);
  await call(c, `workspaces/${w}/contacts`, "POST", person());
  const id = await campaign(c, w);
  const original = db.batch.bind(db);
  let changed = false;
  const wrapped = {
    prepare: db.prepare.bind(db),
    batch: async (statements: any[]) => {
      if (!changed) {
        changed = true;
        db.raw
          .prepare(
            "UPDATE campaigns SET subject='Edited concurrently' WHERE id=?",
          )
          .run(id);
      }
      return original(statements);
    },
  };
  const r = await call(
    { ...c, db: wrapped },
    `workspaces/${w}/campaigns/${id}/queue`,
    "POST",
    {},
  );
  assert.equal(r.status, 409);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM deliveries").first())!.n,
    0,
  );
  assert.equal(
    (await db
      .prepare("SELECT status FROM campaigns WHERE id=?")
      .bind(id)
      .first())!.status,
    "draft",
  );
});
