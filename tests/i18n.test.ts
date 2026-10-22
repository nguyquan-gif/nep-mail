import test from "node:test";
import assert from "node:assert/strict";
import { SqliteDatabase } from "../selfhost/database.ts";
import { handleApi } from "../src/core/api.ts";
import {
  renderEmail,
  campaignSchema,
  unsubscribeToken,
} from "../src/core/domain.ts";
import {
  LOCALE_CODES,
  PACKS,
  bestLocale,
  translate,
  allKeys,
} from "../src/core/i18n.ts";
import type { Context } from "../src/core/types.ts";

const who = { id: "user-a", email: "a@nep-mail.dev", name: "Người A" };
function fixture(liveEnabled = true) {
  const db = new SqliteDatabase(":memory:");
  db.migrate("drizzle");
  const sent: any[] = [];
  const c: Context = {
    db,
    user: who,
    config: {
      runtime: "test",
      liveEnabled,
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
const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("i18n: every locale ships the full key set used by the interface", () => {
  const keys = allKeys();
  assert.ok(
    keys.length >= 270,
    `expected a full dictionary, found ${keys.length}`,
  );
  for (const code of LOCALE_CODES) {
    if (code === "vi" || code === "en") continue;
    const pack = PACKS[code];
    const missing = keys.filter(
      (key) => pack[key] === undefined && pack[`${key}|one`] === undefined,
    );
    assert.deepEqual(missing, [], `${code} is missing ${missing.length} keys`);
  }
});

test("i18n: translations keep every placeholder and are not empty", () => {
  for (const code of LOCALE_CODES) {
    const pack = PACKS[code];
    for (const key of Object.keys(pack)) {
      const value = pack[key];
      assert.ok(
        value.trim().length > 0,
        `${code}: empty translation for ${key}`,
      );
      const source = `${key} ${PACKS.en[key.split("|")[0]] ?? ""}`;
      for (const name of placeholders(source))
        assert.ok(
          placeholders(value).includes(name),
          `${code}: "${key}" dropped {${name}}`,
        );
    }
  }
});

test("i18n: resolution order, plurals and interpolation", () => {
  assert.equal(translate("vi", "Tổng quan"), "Tổng quan");
  assert.equal(translate("en", "Tổng quan"), PACKS.en["Tổng quan"]);
  assert.equal(translate("en", "Chuỗi không tồn tại"), "Chuỗi không tồn tại");
  assert.equal(translate("en", "{n} liên hệ", { n: 1 }), "1 contact");
  assert.equal(translate("en", "{n} liên hệ", { n: 5 }), "5 contacts");
  assert.equal(
    translate("de", "Chuỗi không tồn tại"),
    "Chuỗi không tồn tại",
    "unknown keys fall through to the Vietnamese source",
  );
  assert.equal(bestLocale("fr-CA,fr;q=0.9,en;q=0.5"), "fr");
  assert.equal(bestLocale("pt-BR"), "pt");
  assert.equal(bestLocale("zh-Hant-TW"), "zh");
  assert.equal(bestLocale("xx-YY, *;q=0.1"), "vi");
  assert.equal(bestLocale(null), "vi");
});

test("email rendering: chrome follows the campaign language", () => {
  const base = { subject: "Chào bạn", body: "Nội dung thư", preheader: "" };
  const person = { name: "Minh Anh", email: "minh@example.invalid" };
  const vi = renderEmail(base, person, "Nếp", "https://x/unsub?token=t", "vi");
  const en = renderEmail(base, person, "Nếp", "https://x/unsub?token=t", "en");
  const ja = renderEmail(base, person, "Nếp", "https://x/unsub?token=t", "ja");
  assert.match(vi.html, /<html lang="vi-VN">/);
  assert.match(en.html, /<html lang="en-US">/);
  assert.match(ja.html, /<html lang="ja-JP">/);
  assert.ok(vi.html.includes("Được gửi bởi"));
  assert.ok(en.html.includes("Sent by Nếp with Nếp Mail."));
  assert.ok(
    ja.html.includes(PACKS.ja["email.footer"].split("{brand}")[0].trim()),
  );
  assert.ok(en.text.includes("Unsubscribe: https://x/unsub?token=t"));
  assert.ok(
    !ja.html.includes("Ngừng nhận email"),
    "Japanese email must not leak Vietnamese chrome",
  );
});

test("campaign contract: email language defaults to Vietnamese and is validated", () => {
  const minimal = { name: "Thư", subject: "Chào", body: "Nội dung đủ dài" };
  assert.equal(campaignSchema.parse(minimal).locale, "vi");
  assert.equal(campaignSchema.parse({ ...minimal, locale: "es" }).locale, "es");
  assert.equal(
    campaignSchema.safeParse({ ...minimal, locale: "xx" }).success,
    false,
  );
});

test("API: readiness reasons and errors are localised from Accept-Language", async () => {
  const { c } = fixture(false);
  const es = await call(c, "bootstrap", "GET", undefined, {
    "accept-language": "es-ES,es;q=0.9",
  });
  assert.equal(es.status, 200);
  assert.equal(es.data.delivery.ready, false);
  const spanish = PACKS.es["Chế độ gửi Internet chưa bật"];
  assert.ok(
    es.data.delivery.reasons.includes(spanish),
    es.data.delivery.reasons,
  );
  assert.ok(!es.data.delivery.reasons.includes("Chế độ gửi Internet chưa bật"));

  const ja = await call(
    c,
    "workspaces",
    "POST",
    { name: "x" },
    {
      "accept-language": "ja-JP",
    },
  );
  assert.equal(ja.status, 400);
});

test("API: campaign language is stored, used for preview and survives queueing", async () => {
  const { c, sent, db } = fixture(true);
  const ws = await call(c, "workspaces", "POST", { name: "Nếp" });
  const w = ws.data.id;
  await call(c, "workspaces/" + w + "/contacts", "POST", {
    email: "minh@nep-mail.dev",
    name: "Minh Anh",
    consent: true,
    consentSource: "Biểu mẫu đăng ký",
  });
  const created = await call(c, "workspaces/" + w + "/campaigns", "POST", {
    name: "Thư tiếng Anh",
    subject: "Hello {{first_name}}",
    body: "Một nội dung đủ dài để gửi đi.",
    locale: "en",
  });
  const id = created.data.id;
  const preview = await call(c, `workspaces/${w}/campaigns/${id}/preview`);
  assert.match(preview.data.html, /Sent by Nếp with Nếp Mail\./);
  assert.match(preview.data.html, /<html lang="en-US">/);

  await call(c, `workspaces/${w}/campaigns/${id}/queue`, "POST", {});
  await call(c, `workspaces/${w}/campaigns/${id}/process`, "POST", {});
  assert.equal(sent.length, 1);
  assert.ok(sent[0].html.includes("Sent by Nếp with Nếp Mail."));
  assert.ok(sent[0].unsubscribe.endsWith("&l=en"));

  const row = db.raw
    .prepare("SELECT locale FROM campaigns WHERE id=?")
    .get(id) as {
    locale: string;
  };
  assert.equal(row.locale, "en");
});

test("API: public unsubscribe page speaks the language carried by the link", async () => {
  const { c, db } = fixture(true);
  const ws = await call(c, "workspaces", "POST", { name: "Nếp" });
  const w = ws.data.id;
  await call(c, "workspaces/" + w + "/contacts", "POST", {
    email: "minh@nep-mail.dev",
    name: "Minh Anh",
    consent: true,
    consentSource: "Biểu mẫu đăng ký",
  });
  const contact = db.raw
    .prepare("SELECT id FROM contacts WHERE workspace_id=?")
    .get(w) as { id: string };
  const token = await unsubscribeToken("s".repeat(40), w, contact.id);
  const page = await handleApi(
    new Request(
      `https://mail.nep-mail.dev/api/unsubscribe?token=${token}&l=de`,
      { headers: { "accept-language": "de-DE" } },
    ),
    c,
  );
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /<html lang="de-DE">/);
  assert.ok(html.includes(PACKS.de["unsub.confirm"]));
  assert.ok(!html.includes("Xác nhận hủy nhận"));
});
