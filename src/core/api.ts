import { z } from "zod";
import {
  Problem,
  contactSchema,
  campaignSchema,
  emailSchema,
  importContacts,
  now,
  uuid,
  sha256,
  renderEmail,
  signPayload,
  verifyPayload,
  unsubscribeToken,
  verifyUnsubscribe,
  escapeHtml,
} from "./domain.ts";
import { generateDkimKey, txtChunks } from "./dkim.ts";
import { checkDomain, domainOk, selectorOk } from "./dns.ts";
import {
  dedupe,
  normalizeEvent,
  parseBounce,
  type BounceEvent,
} from "./bounce.ts";
import { isRelayProvider, relayEventsFromPayload } from "./relay.ts";
import type { Context, Row, Statement } from "./types.ts";
import {
  LOCALE_CODES,
  bestLocale,
  isLocale,
  localeTag,
  translate,
  type LocaleCode,
} from "./i18n.ts";
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
function page(locale: LocaleCode, titleKey: string, html: string) {
  return `<!doctype html><html lang="${localeTag(locale)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(translate(locale, titleKey))}</title><body style="font:18px system-ui,Arial,sans-serif;padding:48px;max-width:620px;margin:auto;line-height:1.6;color:#20392e">${html}</body></html>`;
}
const q = (c: Context, sql: string, ...args: unknown[]) =>
  c.db.prepare(sql).bind(...args);
const audit = (
  c: Context,
  w: string,
  action: string,
  detail: string,
  actor?: string,
): Statement =>
  q(
    c,
    "INSERT INTO audit(id,workspace_id,actor,action,detail,created_at) VALUES(?,?,?,?,?,?)",
    uuid(),
    w,
    actor || c.user?.email || "system",
    action,
    detail,
    now(),
  );
async function body(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 600000)
    throw new Problem(413, "Nội dung quá lớn");
  const s = await req.text();
  if (s.length > 600000) throw new Problem(413, "Nội dung quá lớn");
  try {
    return JSON.parse(s);
  } catch {
    throw new Problem(400, "JSON không hợp lệ");
  }
}
function requireUser(c: Context) {
  if (!c.user) throw new Problem(401, "Vui lòng đăng nhập");
  return c.user;
}
async function authorize(c: Context, w: string, write = false, admin = false) {
  const u = requireUser(c);
  const m = await q(
    c,
    "SELECT * FROM members WHERE workspace_id=? AND email=?",
    w,
    u.email.toLowerCase(),
  ).first();
  if (!m) throw new Problem(404, "Không tìm thấy workspace");
  if ((admin && m.role !== "admin") || (write && m.role === "viewer"))
    throw new Problem(403, "Vai trò hiện tại không có quyền thực hiện");
  return m;
}
function requestLocale(req: Request, url: URL): LocaleCode {
  const hint = url.searchParams.get("l");
  if (isLocale(hint)) return hint;
  return bestLocale(req.headers.get("accept-language"));
}
function readiness(c: Context, locale: LocaleCode = "vi") {
  const reasons: string[] = [];
  if (c.config.runtime === "sites")
    reasons.push(translate(locale, "Bản xem riêng tư không mở SMTP"));
  if (!c.config.liveEnabled)
    reasons.push(translate(locale, "Chế độ gửi Internet chưa bật"));
  if (!c.config.transport)
    reasons.push(translate(locale, "Chưa kết nối SMTP tự vận hành"));
  if (!c.config.sender)
    reasons.push(translate(locale, "Chưa cấu hình địa chỉ gửi"));
  if (!c.config.unsubscribeSecret || c.config.unsubscribeSecret.length < 32)
    reasons.push(translate(locale, "Chưa cấu hình khóa ký hủy nhận"));
  try {
    const u = new URL(c.config.publicUnsubscribeOrigin || "");
    if (
      u.origin !== c.config.publicUnsubscribeOrigin ||
      u.protocol !== "https:" ||
      /^(localhost|127\.|\[::1\])/.test(u.hostname)
    )
      throw Error();
  } catch {
    reasons.push(translate(locale, "Cần URL HTTPS công khai cho hủy nhận"));
  }
  return {
    ready: !reasons.length,
    reasons,
    mode: c.config.runtime === "sites" ? "private-preview" : "self-host",
    sender: c.config.sender || null,
    captureAvailable: !!c.config.captureAvailable,
  };
}
const eligible = (p: Row, c: Row) =>
  p.status === "active" &&
  (c.category !== "marketing" || p.consent === 1) &&
  (!c.audience_tag ||
    String(p.tags)
      .split(",")
      .map((s) => s.trim())
      .includes(c.audience_tag));
const campaignLocale = (camp: Row): LocaleCode =>
  isLocale(camp.locale) ? camp.locale : "vi";
async function campaign(c: Context, w: string, id: string) {
  const r = await q(
    c,
    "SELECT * FROM campaigns WHERE workspace_id=? AND id=?",
    w,
    id,
  ).first();
  if (!r) throw new Problem(404, "Không tìm thấy chiến dịch");
  return r;
}
async function audience(c: Context, w: string, camp: Row) {
  const all = (
    await q(
      c,
      "SELECT * FROM contacts WHERE workspace_id=? ORDER BY created_at DESC LIMIT 501",
      w,
    ).all()
  ).results;
  if (all.length > 500)
    throw new Problem(409, "Bản alpha giới hạn audience 500 liên hệ/workspace");
  const yes = all.filter((p) => eligible(p, camp));
  return { all, yes };
}
function contactInsert(
  c: Context,
  w: string,
  p: z.infer<typeof contactSchema>,
  allowConsent = true,
) {
  return q(
    c,
    `INSERT INTO contacts(id,workspace_id,email,name,tags,status,consent,consent_source,consent_at,created_at) VALUES(?,?,?,?,?,'active',?,?,?,?) ON CONFLICT(workspace_id,email) DO UPDATE SET name=excluded.name,tags=excluded.tags,consent=CASE WHEN contacts.status='active' THEN MAX(contacts.consent,excluded.consent) ELSE contacts.consent END,consent_source=CASE WHEN contacts.status='active' AND contacts.consent=0 AND excluded.consent=1 THEN excluded.consent_source ELSE contacts.consent_source END,consent_at=CASE WHEN contacts.status='active' AND contacts.consent=0 AND excluded.consent=1 THEN excluded.consent_at ELSE contacts.consent_at END`,
    uuid(),
    w,
    p.email,
    p.name,
    p.tags,
    allowConsent && p.consent ? 1 : 0,
    allowConsent && p.consent ? p.consentSource : "",
    allowConsent && p.consent ? now() : null,
    now(),
  );
}
async function integrate(req: Request, c: Context) {
  const raw = req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!raw.startsWith("nep_") || raw.length > 150)
    throw new Problem(401, "API key không hợp lệ");
  const key = await q(
    c,
    "SELECT * FROM integration_keys WHERE digest=? AND revoked_at IS NULL",
    await sha256(raw),
  ).first();
  if (!key) throw new Problem(401, "API key không hợp lệ hoặc đã thu hồi");
  const p = z
    .object({
      id: z.string().trim().min(1).max(160),
      type: z.enum(["contact.upsert", "contact.unsubscribe"]),
      contact: z.object({
        email: emailSchema,
        name: z.string().trim().min(1).max(160),
        tags: z.string().max(200).default(""),
      }),
    })
    .parse(await body(req));
  const prior = await q(
    c,
    "SELECT id FROM integration_events WHERE workspace_id=? AND key_id=? AND external_id=?",
    key.workspace_id,
    key.id,
    p.id,
  ).first();
  if (prior) return json({ duplicate: true });
  const insert = q(
    c,
    "INSERT INTO integration_events(id,workspace_id,key_id,external_id,type,created_at) VALUES(?,?,?,?,?,?)",
    uuid(),
    key.workspace_id,
    key.id,
    p.id,
    p.type,
    now(),
  );
  const update =
    p.type === "contact.upsert"
      ? contactInsert(
          c,
          key.workspace_id,
          {
            ...p.contact,
            tags: [p.contact.tags, key.source].filter(Boolean).join(","),
            consent: false,
            consentSource: "",
          },
          false,
        )
      : q(
          c,
          "INSERT INTO contacts(id,workspace_id,email,name,tags,status,consent,consent_source,created_at) VALUES(?,?,?,?,?,'unsubscribed',0,'',?) ON CONFLICT(workspace_id,email) DO UPDATE SET status='unsubscribed',consent=0",
          uuid(),
          key.workspace_id,
          p.contact.email,
          p.contact.name,
          key.source,
          now(),
        );
  try {
    await c.db.batch([
      insert,
      update,
      audit(
        c,
        key.workspace_id,
        "integration.event",
        `${key.source}: ${p.type}`,
        `key:${key.id}`,
      ),
    ]);
  } catch (e) {
    if (
      await q(
        c,
        "SELECT id FROM integration_events WHERE workspace_id=? AND key_id=? AND external_id=?",
        key.workspace_id,
        key.id,
        p.id,
      ).first()
    )
      return json({ duplicate: true });
    throw e;
  }
  return json({ accepted: true, marketingConsentGranted: false });
}
async function unsubscribe(req: Request, c: Context, url: URL) {
  const secret = c.config.unsubscribeSecret;
  const locale = requestLocale(req, url);
  if (!secret) throw new Problem(503, "Hủy nhận chưa được cấu hình");
  const p = await verifyUnsubscribe(
    secret,
    url.searchParams.get("token") || "",
  );
  if (!p) throw new Problem(400, "Liên kết hủy nhận không hợp lệ");
  const row = await q(
    c,
    "SELECT id FROM contacts WHERE workspace_id=? AND id=?",
    p.workspace,
    p.contact,
  ).first();
  if (!row) throw new Problem(404, "Liên kết không còn hiệu lực");
  if (req.method === "POST") {
    await c.db.batch([
      q(
        c,
        "UPDATE contacts SET status='unsubscribed',consent=0 WHERE workspace_id=? AND id=?",
        p.workspace,
        p.contact,
      ),
      audit(
        c,
        p.workspace,
        "contact.unsubscribe",
        "Hủy nhận từ liên kết đã ký",
        "recipient",
      ),
    ]);
    return new Response(
      page(
        locale,
        "unsub.done",
        `<h1>${escapeHtml(translate(locale, "unsub.done"))}</h1><p>${escapeHtml(translate(locale, "unsub.doneBody"))}</p>`,
      ),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      },
    );
  }
  return new Response(
    page(
      locale,
      "unsub.title",
      `<h1>${escapeHtml(translate(locale, "unsub.title"))}</h1><p>${escapeHtml(translate(locale, "unsub.intro"))}</p><form method="post" action="${escapeHtml(url.pathname + url.search)}"><button style="padding:14px 24px;font:inherit">${escapeHtml(translate(locale, "unsub.confirm"))}</button></form>`,
    ),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    },
  );
}
export async function processCampaign(
  c: Context,
  w: string,
  id: string,
  locale: LocaleCode = "vi",
) {
  const r = readiness(c, locale);
  if (!r.ready) throw new Problem(409, r.reasons.join(". "));
  const camp = await campaign(c, w, id);
  if (camp.status !== "queued")
    throw new Problem(409, "Chiến dịch không ở hàng đợi");
  if (camp.scheduled_at && camp.scheduled_at > now())
    throw new Problem(409, "Chưa đến giờ gửi");
  const ws = await q(c, "SELECT name FROM workspaces WHERE id=?", w).first();
  const rows = (
    await q(
      c,
      "SELECT * FROM deliveries WHERE workspace_id=? AND campaign_id=? AND status='pending' LIMIT 10",
      w,
      id,
    ).all()
  ).results;
  for (const d of rows) {
    const claim = await q(
      c,
      "UPDATE deliveries SET status='submitting',updated_at=? WHERE id=? AND workspace_id=? AND status='pending' AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND workspace_id=? AND status='queued') RETURNING id",
      now(),
      d.id,
      w,
      id,
      w,
    ).first();
    if (!claim) continue;
    const person = await q(
      c,
      "SELECT * FROM contacts WHERE workspace_id=? AND id=?",
      w,
      d.contact_id,
    ).first();
    const current = await campaign(c, w, id);
    if (
      !person ||
      !eligible(person, camp) ||
      current.status !== "queued" ||
      /\.(invalid|test|localhost)$/i.test(d.email)
    ) {
      await q(
        c,
        "UPDATE deliveries SET status='skipped',error=?,updated_at=? WHERE id=? AND workspace_id=?",
        "Đã chặn, hủy hoặc địa chỉ thử nghiệm",
        now(),
        d.id,
        w,
      ).run();
      continue;
    }
    const token = await unsubscribeToken(
      c.config.unsubscribeSecret!,
      w,
      d.contact_id,
    );
    const campaignLocale: LocaleCode = isLocale(camp.locale)
      ? camp.locale
      : "vi";
    const link = `${c.config.publicUnsubscribeOrigin}/api/unsubscribe?token=${token}&l=${campaignLocale}`;
    const rendered = renderEmail(
      camp as { subject: string; body: string; preheader: string },
      d as { name: string; email: string },
      ws!.name,
      link,
      campaignLocale,
    );
    try {
      const result = await c.config.transport!.send({
        ...rendered,
        to: d.email,
        unsubscribe: link,
        idempotencyKey: d.id,
      });
      await q(
        c,
        "UPDATE deliveries SET status='accepted',provider_id=?,updated_at=? WHERE id=? AND workspace_id=?",
        result.id,
        now(),
        d.id,
        w,
      ).run();
    } catch {
      await q(
        c,
        "UPDATE deliveries SET status='unknown',error='SMTP chưa xác nhận kết quả. Không tự gửi lại.',updated_at=? WHERE id=? AND workspace_id=?",
        now(),
        d.id,
        w,
      ).run();
    }
  }
  const left = await q(
    c,
    "SELECT COUNT(*) AS n FROM deliveries WHERE workspace_id=? AND campaign_id=? AND status IN ('pending','submitting')",
    w,
    id,
  ).first();
  if (!left?.n)
    await q(
      c,
      "UPDATE campaigns SET status='completed',updated_at=? WHERE workspace_id=? AND id=? AND status='queued'",
      now(),
      w,
      id,
    ).run();
  await audit(
    c,
    w,
    "campaign.process",
    `Đã xử lý tối đa ${rows.length} thư`,
  ).run();
  return { processed: rows.length };
}

/* ------------------------------------------------------------------ *
 * Public signup forms with double opt-in
 * ------------------------------------------------------------------ */

const signupAttempts = new Map<string, { n: number; until: number }>();

function signupAllowed(ip: string, limit = 20): boolean {
  const entry = signupAttempts.get(ip);
  const fresh =
    entry && entry.until > Date.now()
      ? entry
      : { n: 0, until: Date.now() + 3_600_000 };
  fresh.n += 1;
  signupAttempts.set(ip, fresh);
  if (signupAttempts.size > 5000) signupAttempts.clear();
  return fresh.n <= limit;
}

async function readPublicBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const parsed = (await body(req)) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed || {}).map(([k, v]) => [k, String(v ?? "")]),
    );
  }
  const raw = await req.text();
  if (raw.length > 20_000) throw new Problem(413, "Nội dung quá lớn");
  return Object.fromEntries(new URLSearchParams(raw));
}

function formPage(
  locale: LocaleCode,
  title: string,
  inner: string,
  status = 200,
): Response {
  const html = `<!doctype html><html lang="${localeTag(locale)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><body style="margin:0;background:#f3f5f2;font:16px system-ui,Arial,sans-serif;color:#20392e"><main style="max-width:520px;margin:9vh auto;padding:0 20px"><div style="background:#fff;border:1px solid #e4e8e4;border-radius:10px;padding:34px">${inner}</div><p style="text-align:center;font-size:12px;color:#6b7a70;margin-top:18px">Nếp Mail</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function signupFormHtml(
  locale: LocaleCode,
  form: Row,
  action: string,
  error = "",
): Response {
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  return formPage(
    locale,
    t("Đăng ký nhận email"),
    `<h1 style="font-size:24px;margin:0 0 8px">${escapeHtml(form.name)}</h1><p style="margin:0 0 22px;color:#596960;line-height:1.6">${escapeHtml(t("Chúng tôi gửi email hữu ích, không spam. Bạn có thể hủy nhận bất cứ lúc nào."))}</p>${error ? `<p role="alert" style="background:#fdeceb;color:#8b2f24;padding:12px;border-radius:6px;margin:0 0 18px">${escapeHtml(error)}</p>` : ""}<form method="post" action="${escapeHtml(action)}"><label style="display:block;font-size:13px;margin-bottom:14px">${escapeHtml(t("Họ và tên"))}<input name="name" maxlength="160" autocomplete="name" style="display:block;width:100%;box-sizing:border-box;padding:12px;margin-top:6px;border:1px solid #cfd8d1;border-radius:6px;font:inherit"></label><label style="display:block;font-size:13px;margin-bottom:14px">${escapeHtml(t("Địa chỉ email"))}<input name="email" type="email" required maxlength="254" autocomplete="email" style="display:block;width:100%;box-sizing:border-box;padding:12px;margin-top:6px;border:1px solid #cfd8d1;border-radius:6px;font:inherit"></label><input name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true"><button style="width:100%;padding:13px;border:0;border-radius:6px;background:#235642;color:#fff;font:inherit;font-weight:600;cursor:pointer">${escapeHtml(t("Đăng ký"))}</button></form><p style="font-size:12px;color:#6b7a70;margin:16px 0 0;line-height:1.6">${escapeHtml(t("Chúng tôi lưu nguồn đồng ý của bạn và chỉ gửi email marketing sau khi bạn xác nhận."))}</p>`,
  );
}

function signupDoneHtml(locale: LocaleCode, email: string): Response {
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(locale, key, vars);
  return formPage(
    locale,
    t("Kiểm tra hộp thư của bạn"),
    `<h1 style="font-size:22px;margin:0 0 10px">${escapeHtml(t("Kiểm tra hộp thư của bạn"))}</h1><p style="margin:0;color:#596960;line-height:1.7">${escapeHtml(t("Chúng tôi đã gửi liên kết xác nhận tới {email}. Mở liên kết để hoàn tất đăng ký.", { email }))}</p>`,
  );
}

async function publicSignup(
  req: Request,
  c: Context,
  url: URL,
  slug: string,
): Promise<Response> {
  const form = await q(
    c,
    "SELECT f.*, w.name AS brand FROM signup_forms f JOIN workspaces w ON w.id=f.workspace_id WHERE f.slug=?",
    slug,
  ).first();
  if (!form || !form.active)
    return formPage(
      "vi",
      "Biểu mẫu này hiện không nhận đăng ký.",
      `<h1 style="font-size:22px;margin:0 0 8px">${escapeHtml(translate("vi", "Biểu mẫu này hiện không nhận đăng ký."))}</h1>`,
      404,
    );
  const locale: LocaleCode = isLocale(form.locale) ? form.locale : "vi";
  const action = `/api/public/signup/${encodeURIComponent(slug)}`;
  if (req.method === "GET") return signupFormHtml(locale, form, action);

  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "local";
  if (!signupAllowed(ip))
    return signupFormHtml(
      locale,
      form,
      action,
      translate(locale, "Quá nhiều lần đăng ký. Vui lòng thử lại sau."),
    );

  const data = await readPublicBody(req);
  if (data.company) return signupDoneHtml(locale, ""); // honeypot
  const parsed = emailSchema.safeParse(data.email || "");
  if (!parsed.success)
    return signupFormHtml(
      locale,
      form,
      action,
      translate(locale, "Email chưa hợp lệ."),
    );
  const email = parsed.data;
  const name =
    (data.name || "").trim().slice(0, 160) || email.split("@")[0] || "bạn";

  const existing = await q(
    c,
    "SELECT id,status,consent FROM contacts WHERE workspace_id=? AND email=?",
    form.workspace_id,
    email,
  ).first();
  // Never resurrect an address that opted out or was blocked, and never
  // re-send a confirmation to someone who already consented.
  if (
    existing &&
    (existing.status === "unsubscribed" ||
      existing.status === "suppressed" ||
      (existing.status === "active" && existing.consent === 1))
  )
    return signupDoneHtml(locale, email);

  if (!c.config.transport)
    return formPage(
      locale,
      "Chưa thể gửi email xác nhận",
      `<h1 style="font-size:22px;margin:0 0 8px">${escapeHtml(translate(locale, "Chưa thể gửi email xác nhận"))}</h1><p style="color:#596960">${escapeHtml(translate(locale, "Máy chủ gửi chưa được cấu hình."))}</p>`,
      503,
    );

  const createdAt = now();
  if (existing) {
    await q(
      c,
      "UPDATE contacts SET name=?,tags=CASE WHEN tags='' THEN ? ELSE tags || ',' || ? END,status='pending',consent=0,consent_source='',created_at=created_at WHERE workspace_id=? AND id=?",
      name,
      form.tag || "",
      form.tag || "",
      form.workspace_id,
      existing.id,
    ).run();
  } else {
    await q(
      c,
      "INSERT INTO contacts(id,workspace_id,email,name,tags,status,consent,consent_source,created_at) VALUES(?,?,?,?,?,'pending',0,'',?)",
      uuid(),
      form.workspace_id,
      email,
      name,
      form.tag || "",
      createdAt,
    ).run();
  }

  const expires = new Date(Date.now() + 48 * 3600_000).toISOString();
  const token = await signPayload(
    c.config.unsubscribeSecret || "",
    `${form.id}|${email}|${expires}`,
  );
  const digest = await sha256(token);
  await c.db.batch([
    q(
      c,
      "UPDATE signup_requests SET used_at=? WHERE form_id=? AND email=? AND used_at IS NULL",
      createdAt,
      form.id,
      email,
    ),
    q(
      c,
      "INSERT INTO signup_requests(id,workspace_id,form_id,email,name,token_digest,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
      uuid(),
      form.workspace_id,
      form.id,
      email,
      name,
      digest,
      expires,
      createdAt,
    ),
    audit(
      c,
      form.workspace_id,
      "signup.requested",
      `${form.slug}: ${email}`,
      "public-form",
    ),
  ]);

  const origin = c.config.publicUnsubscribeOrigin || url.origin;
  const link = `${origin}/api/public/confirm?token=${encodeURIComponent(token)}`;
  const brand = String(form.brand || "Nếp Mail");
  const subject = translate(locale, "Xác nhận đăng ký nhận email từ {brand}", {
    brand,
  });
  const text = translate(
    locale,
    "Chào {name},\n\nXác nhận địa chỉ email của bạn để nhận tin từ {brand}:\n{url}\n\nNếu bạn không đăng ký, hãy bỏ qua email này. Liên kết hết hạn sau 48 giờ.",
    { name, brand, url: link },
  );
  const html = `<!doctype html><html lang="${localeTag(locale)}"><meta charset="utf-8"><title>${escapeHtml(subject)}</title><body style="font:16px system-ui,Arial,sans-serif;color:#20392e;padding:24px"><p style="white-space:pre-line;line-height:1.7">${escapeHtml(text)}</p></body></html>`;
  try {
    await c.config.transport.send({
      to: email,
      subject,
      html,
      text,
      unsubscribe: link,
      idempotencyKey: `signup-${digest.slice(0, 32)}`,
    });
  } catch {
    throw new Problem(502, "Chưa thể gửi email xác nhận");
  }
  return signupDoneHtml(locale, email);
}

async function publicConfirm(
  req: Request,
  c: Context,
  url: URL,
): Promise<Response> {
  const token = url.searchParams.get("token") || "";
  const payload = await verifyPayload(c.config.unsubscribeSecret || "", token);
  if (!payload) {
    const locale = "vi";
    return formPage(
      locale,
      "Liên kết xác nhận không hợp lệ hoặc đã hết hạn.",
      `<h1 style="font-size:22px;margin:0 0 8px">${escapeHtml(translate(locale, "Liên kết xác nhận không hợp lệ hoặc đã hết hạn."))}</h1>`,
      400,
    );
  }
  const [formId, email, expires] = payload.split("|");
  const form = await q(
    c,
    "SELECT f.*, w.name AS brand FROM signup_forms f JOIN workspaces w ON w.id=f.workspace_id WHERE f.id=?",
    formId,
  ).first();
  const locale: LocaleCode = isLocale(form?.locale) ? form.locale : "vi";
  if (!form)
    return formPage(
      locale,
      "Liên kết xác nhận không hợp lệ hoặc đã hết hạn.",
      `<h1 style="font-size:22px">${escapeHtml(translate(locale, "Liên kết xác nhận không hợp lệ hoặc đã hết hạn."))}</h1>`,
      404,
    );
  if (Date.parse(expires) < Date.now())
    return formPage(
      locale,
      "Liên kết xác nhận không hợp lệ hoặc đã hết hạn.",
      `<h1 style="font-size:22px;margin:0 0 8px">${escapeHtml(translate(locale, "Liên kết xác nhận không hợp lệ hoặc đã hết hạn."))}</h1>`,
      410,
    );

  const digest = await sha256(token);
  const request = await q(
    c,
    "SELECT * FROM signup_requests WHERE token_digest=?",
    digest,
  ).first();
  if (!request)
    return formPage(
      locale,
      "Liên kết xác nhận không hợp lệ hoặc đã hết hạn.",
      `<h1 style="font-size:22px">${escapeHtml(translate(locale, "Liên kết xác nhận không hợp lệ hoặc đã hết hạn."))}</h1>`,
      404,
    );
  if (request.used_at)
    return formPage(
      locale,
      "Đã xác nhận trước đó.",
      `<h1 style="font-size:22px;margin:0 0 8px">${escapeHtml(translate(locale, "Đã xác nhận trước đó."))}</h1><p style="color:#596960">${escapeHtml(translate(locale, "Địa chỉ này đã được xác nhận. Bạn không cần làm gì thêm."))}</p>`,
    );

  if (req.method === "GET")
    return formPage(
      locale,
      "Xác nhận đăng ký",
      `<h1 style="font-size:22px;margin:0 0 10px">${escapeHtml(translate(locale, "Xác nhận đăng ký"))}</h1><p style="color:#596960;line-height:1.7;margin:0 0 20px">${escapeHtml(translate(locale, "Xác nhận để nhận email từ {brand}.", { brand: String(form.brand) }))}</p><form method="post" action="${escapeHtml(url.pathname + url.search)}"><button style="padding:13px 22px;border:0;border-radius:6px;background:#235642;color:#fff;font:inherit;font-weight:600;cursor:pointer">${escapeHtml(translate(locale, "Xác nhận đăng ký"))}</button></form>`,
    );

  const stamp = now();
  await c.db.batch([
    q(
      c,
      "UPDATE contacts SET status='active',consent=1,consent_source=?,consent_at=? WHERE workspace_id=? AND email=? AND status IN ('pending','active')",
      form.consent_source,
      stamp,
      form.workspace_id,
      request.email,
    ),
    q(
      c,
      "UPDATE signup_requests SET used_at=? WHERE id=? AND used_at IS NULL",
      stamp,
      request.id,
    ),
    audit(
      c,
      form.workspace_id,
      "signup.confirmed",
      `${form.slug}: ${request.email}`,
      "recipient",
    ),
  ]);
  return formPage(
    locale,
    "Đã xác nhận đăng ký",
    `<h1 style="font-size:22px;margin:0 0 10px">${escapeHtml(translate(locale, "Đã xác nhận đăng ký"))}</h1><p style="color:#596960;line-height:1.7;margin:0">${escapeHtml(translate(locale, "Cảm ơn bạn. Bạn sẽ nhận email từ {brand}.", { brand: String(form.brand) }))}</p>`,
  );
}

/* ------------------------------------------------------------------ *
 * Bounce / complaint ingestion
 * ------------------------------------------------------------------ */

async function keyFromRequest(req: Request, c: Context) {
  const raw = req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!raw.startsWith("nep_") || raw.length > 150)
    throw new Problem(401, "API key không hợp lệ");
  const key = await q(
    c,
    "SELECT * FROM integration_keys WHERE digest=? AND revoked_at IS NULL",
    await sha256(raw),
  ).first();
  if (!key) throw new Problem(401, "API key không hợp lệ hoặc đã thu hồi");
  return key;
}

/**
 * Suppress every address in `events` (hard bounces and complaints) and record
 * the reason. Without `workspaceId`, the event is applied across the instance:
 * a hard bounce on a shared sending domain is not workspace-specific.
 */
export async function applyBounceEvents(
  c: Context,
  events: BounceEvent[],
  workspaceId?: string,
  actor = "system",
) {
  let suppressed = 0;
  const workspaceIds = workspaceId
    ? [workspaceId]
    : ((await q(c, "SELECT id FROM workspaces").all()).results as Row[]).map(
        (row) => String(row.id),
      );
  for (const event of events) {
    if (event.kind === "soft") continue;
    const action =
      event.kind === "complaint" ? "contact.complaint" : "contact.bounce";
    for (const w of workspaceIds) {
      const result = await q(
        c,
        "UPDATE contacts SET status='suppressed',consent=0 WHERE workspace_id=? AND email=? AND status<>'suppressed'",
        w,
        event.email,
      ).run();
      if ((result as { changes?: number })?.changes) suppressed += 1;
      if ((result as { changes?: number })?.changes || workspaceId)
        await audit(
          c,
          w,
          action,
          `${event.email}${event.status ? " · " + event.status : ""}`,
          actor,
        ).run();
    }
  }
  return { received: events.length, suppressed };
}

/**
 * Test sends cost real provider quota in live mode, so they are capped per
 * workspace instead of being unlimited. In-memory on purpose: it guards against
 * a double click or a stuck loop, not a determined attacker.
 */
const testSends = new Map<string, number[]>();
export function allowTestSend(workspace: string, nowMs = Date.now()): boolean {
  const windowMs = 10 * 60_000;
  const hits = (testSends.get(workspace) || []).filter(
    (t) => nowMs - t < windowMs,
  );
  if (hits.length >= 5) {
    testSends.set(workspace, hits);
    return false;
  }
  hits.push(nowMs);
  testSends.set(workspace, hits);
  return true;
}

/** Constant-time-ish comparison for a shared secret. */
function secretMatches(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Bounce/complaint webhook from a sending relay.
 *
 * Providers do not sign their webhooks (Brevo does not), so the URL carries a
 * shared secret. This endpoint only suppresses addresses; it cannot create
 * contacts, grant consent or send anything.
 */
async function relayWebhook(
  req: Request,
  c: Context,
  url: URL,
  provider: string,
) {
  if (!isRelayProvider(provider)) throw new Problem(404, "Không tìm thấy API");
  const secret = c.config.relayWebhookSecret;
  if (!secret || secret.length < 16)
    throw new Problem(503, "Webhook chưa được cấu hình");
  if (!secretMatches(url.searchParams.get("token") || "", secret))
    throw new Problem(401, "Token webhook không hợp lệ");
  const events = relayEventsFromPayload(provider, await body(req)).slice(
    0,
    200,
  );
  if (!events.length) return json({ received: 0, suppressed: 0 });
  return json(
    await applyBounceEvents(c, events, undefined, `relay:${provider}`),
  );
}

async function ingestBounces(req: Request, c: Context) {
  const key = await keyFromRequest(req, c);
  const payload = (await body(req)) as {
    message?: string;
    events?: unknown[];
    email?: string;
    kind?: string;
  };
  let events: BounceEvent[] = [];
  if (typeof payload.message === "string")
    events = parseBounce(payload.message);
  if (Array.isArray(payload.events))
    events = events.concat(
      payload.events.map(normalizeEvent).filter((v): v is BounceEvent => !!v),
    );
  if (payload.email) {
    const single = normalizeEvent(payload);
    if (single) events.push(single);
  }
  events = dedupe(events).slice(0, 200);
  if (!events.length)
    throw new Problem(400, "Không tìm thấy bounce trong nội dung");
  return json(
    await applyBounceEvents(c, events, key.workspace_id, `key:${key.id}`),
  );
}

export async function handleApi(req: Request, c: Context): Promise<Response> {
  let locale: LocaleCode = "vi";
  try {
    const url = new URL(req.url),
      path = url.pathname
        .replace(/^\/api\/?/, "")
        .split("/")
        .filter(Boolean),
      method = req.method;
    locale = requestLocale(req, url);
    if (path[0] === "unsubscribe" && ["GET", "POST"].includes(method))
      return await unsubscribe(req, c, url);
    // Public surfaces: a recipient has no session and may post cross-origin.
    if (path[0] === "public" && path[1] === "signup" && path[2])
      return await publicSignup(req, c, url, decodeURIComponent(path[2]));
    if (path[0] === "public" && path[1] === "confirm")
      return await publicConfirm(req, c, url);
    if (!["GET", "HEAD"].includes(method)) {
      const origin = req.headers.get("origin");
      if (
        (origin && origin !== url.origin) ||
        req.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new Problem(403, "Yêu cầu khác nguồn bị chặn");
    }
    if (path[0] === "v1" && path[1] === "events" && method === "POST")
      return await integrate(req, c);
    if (path[0] === "v1" && path[1] === "bounces" && method === "POST")
      return await ingestBounces(req, c);
    if (
      path[0] === "v1" &&
      path[1] === "webhooks" &&
      path[2] &&
      method === "POST"
    )
      return await relayWebhook(req, c, url, path[2]);
    const user = requireUser(c);
    if (path[0] === "bootstrap" && method === "GET") {
      const ws = (
        await q(
          c,
          "SELECT w.*,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.email=? ORDER BY w.created_at",
          user.email.toLowerCase(),
        ).all()
      ).results;
      return json({ user, workspaces: ws, delivery: readiness(c, locale) });
    }
    if (path[0] === "workspaces" && path.length === 1 && method === "POST") {
      const p = z
        .object({ name: z.string().trim().min(2).max(100) })
        .parse(await body(req));
      const w = uuid();
      await c.db.batch([
        q(
          c,
          "INSERT INTO workspaces(id,name,created_at) VALUES(?,?,?)",
          w,
          p.name,
          now(),
        ),
        q(
          c,
          "INSERT INTO members(id,workspace_id,email,role) VALUES(?,?,?,?)",
          uuid(),
          w,
          user.email.toLowerCase(),
          "admin",
        ),
        audit(c, w, "workspace.created", p.name),
      ]);
      return json({ id: w }, 201);
    }
    if (path[0] !== "workspaces" || !path[1])
      throw new Problem(404, "Không tìm thấy API");
    const w = path[1],
      resource = path[2],
      id = path[3],
      action = path[4];
    await authorize(
      c,
      w,
      method !== "GET",
      resource === "members" ||
        resource === "keys" ||
        resource === "forms" ||
        resource === "dkim",
    );
    if (!resource && method === "GET") {
      const ws = await q(c, "SELECT * FROM workspaces WHERE id=?", w).first();
      const [people, camps, logs, keys, team, counts] = await Promise.all([
        q(
          c,
          "SELECT * FROM contacts WHERE workspace_id=? ORDER BY created_at DESC LIMIT 501",
          w,
        ).all(),
        q(
          c,
          "SELECT * FROM campaigns WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 200",
          w,
        ).all(),
        q(
          c,
          "SELECT * FROM audit WHERE workspace_id=? ORDER BY created_at DESC LIMIT 80",
          w,
        ).all(),
        q(
          c,
          "SELECT id,name,source,created_at,revoked_at FROM integration_keys WHERE workspace_id=?",
          w,
        ).all(),
        q(c, "SELECT id,email,role FROM members WHERE workspace_id=?", w).all(),
        q(
          c,
          "SELECT status,COUNT(*) AS n FROM deliveries WHERE workspace_id=? GROUP BY status",
          w,
        ).all(),
      ]);
      return json({
        workspace: ws,
        contacts: people.results,
        campaigns: camps.results,
        audit: logs.results,
        keys: keys.results,
        members: team.results,
        forms: (
          await q(
            c,
            "SELECT * FROM signup_forms WHERE workspace_id=? ORDER BY created_at DESC",
            w,
          ).all()
        ).results,
        deliveryCounts: counts.results,
      });
    }
    // The workspace name is printed in the footer of every email it sends, so a
    // typo there follows every recipient until it can be corrected.
    if (!resource && method === "PATCH") {
      const p = z
        .object({ name: z.string().trim().min(2).max(100) })
        .parse(await body(req));
      const saved = await q(
        c,
        "UPDATE workspaces SET name=? WHERE id=? RETURNING id",
        p.name,
        w,
      ).first();
      if (!saved) throw new Problem(404, "Không tìm thấy workspace");
      await audit(c, w, "workspace.renamed", p.name).run();
      return json({ ok: true });
    }
    if (resource === "contacts" && method === "POST" && !id) {
      const p = contactSchema.parse(await body(req));
      await c.db.batch([
        contactInsert(c, w, p),
        audit(c, w, "contact.saved", p.email),
      ]);
      return json({ ok: true });
    }
    if (resource === "contacts" && id === "import" && method === "POST") {
      const p = z
        .object({ csv: z.string().max(500000) })
        .parse(await body(req));
      const all = importContacts(p.csv);
      await c.db.batch([
        ...all.map((p) => contactInsert(c, w, p)),
        audit(c, w, "contacts.imported", `${all.length} dòng đã xử lý`),
      ]);
      return json({
        processed: all.length,
        unique: new Set(all.map((v) => v.email)).size,
      });
    }
    if (resource === "contacts" && id && method === "PATCH") {
      const p = z
        .object({ status: z.enum(["unsubscribed", "suppressed"]) })
        .parse(await body(req));
      const found = await q(
        c,
        "SELECT id FROM contacts WHERE workspace_id=? AND id=?",
        w,
        id,
      ).first();
      if (!found) throw new Problem(404, "Không tìm thấy liên hệ");
      await c.db.batch([
        q(
          c,
          "UPDATE contacts SET status=?,consent=0 WHERE workspace_id=? AND id=?",
          p.status,
          w,
          id,
        ),
        audit(c, w, "contact.blocked", `${id}: ${p.status}`),
      ]);
      return json({ ok: true });
    }
    if (resource === "campaigns" && method === "POST" && !id) {
      const p = campaignSchema.parse(await body(req)),
        cid = uuid();
      await c.db.batch([
        q(
          c,
          "INSERT INTO campaigns(id,workspace_id,name,subject,preheader,body,category,audience_tag,locale,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)",
          cid,
          w,
          p.name,
          p.subject,
          p.preheader,
          p.body,
          p.category,
          p.audienceTag,
          p.locale,
          now(),
          now(),
        ),
        audit(c, w, "campaign.created", p.name),
      ]);
      return json({ id: cid }, 201);
    }
    if (resource === "campaigns" && id) {
      const camp = await campaign(c, w, id);
      if (method === "PATCH" && !action) {
        const p = campaignSchema.parse(await body(req));
        if (camp.status !== "draft")
          throw new Problem(409, "Chỉ chỉnh sửa chiến dịch nháp");
        const saved = await q(
          c,
          "UPDATE campaigns SET name=?,subject=?,preheader=?,body=?,category=?,audience_tag=?,locale=?,updated_at=? WHERE workspace_id=? AND id=? AND status='draft' RETURNING id",
          p.name,
          p.subject,
          p.preheader,
          p.body,
          p.category,
          p.audienceTag,
          p.locale,
          now(),
          w,
          id,
        ).first();
        if (!saved) throw new Problem(409, "Chiến dịch đã thay đổi");
        await audit(c, w, "campaign.updated", p.name).run();
        return json({ ok: true });
      }
      if (action === "test" && method === "POST") {
        await authorize(c, w, true, true);
        if (
          !c.config.transport ||
          (!c.config.liveEnabled && !c.config.captureAvailable)
        )
          throw new Problem(409, "Chưa cấu hình cách gửi thư");
        const p = z
          .object({
            to: z
              .string()
              .trim()
              .max(200)
              .regex(
                /^[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}$/i,
                "Địa chỉ email không hợp lệ",
              ),
          })
          .parse(await body(req));
        if (!allowTestSend(w))
          throw new Problem(429, "Đã gửi thử 5 lần trong 10 phút, thử lại sau");
        const ws = await q(
          c,
          "SELECT name FROM workspaces WHERE id=?",
          w,
        ).first();
        // The opt-out link is a preview token: it opens the real page but has no
        // contact behind it, so it cannot unsubscribe anyone by accident.
        const unsub = `${(c.config.publicUnsubscribeOrigin || "").replace(/\/$/, "")}/api/unsubscribe?token=preview`;
        const r = renderEmail(
          camp as { subject: string; body: string; preheader: string },
          { name: "Bạn", email: p.to },
          ws!.name,
          unsub,
          campaignLocale(camp),
        );
        await c.config.transport.send({
          ...r,
          to: p.to,
          unsubscribe: unsub,
          idempotencyKey: uuid(),
        });
        await audit(c, w, "campaign.test_sent", `${camp.name} → ${p.to}`).run();
        return json({
          ok: true,
          mode: c.config.liveEnabled ? "live" : "capture",
          to: p.to,
        });
      }
      if (action === "preflight" && method === "GET") {
        const a = await audience(c, w, camp);
        return json({
          eligible: a.yes.length,
          excluded: a.all.length - a.yes.length,
          delivery: readiness(c, locale),
          deliveries: (
            await q(
              c,
              "SELECT status,COUNT(*) AS n FROM deliveries WHERE workspace_id=? AND campaign_id=? GROUP BY status",
              w,
              id,
            ).all()
          ).results,
        });
      }
      if (action === "preview" && method === "GET") {
        const ws = await q(
          c,
          "SELECT name FROM workspaces WHERE id=?",
          w,
        ).first();
        const r = renderEmail(
          camp as { subject: string; body: string; preheader: string },
          { name: "Nguyễn Minh Anh", email: "minhanh@example.invalid" },
          ws!.name,
          "#preview-only",
          campaignLocale(camp),
        );
        return json(r);
      }
      if (action === "queue" && method === "POST") {
        if (camp.status !== "draft")
          throw new Problem(409, "Chỉ xếp hàng chiến dịch nháp");
        const p = z
          .object({
            scheduledAt: z.string().datetime({ offset: true }).optional(),
          })
          .parse(await body(req));
        const a = await audience(c, w, camp);
        if (!a.yes.length)
          throw new Problem(409, "Không có người nhận đủ điều kiện");
        const scheduled = p.scheduledAt
          ? new Date(p.scheduledAt).toISOString()
          : now();
        const queueToken = uuid();
        const updates = [
          q(
            c,
            "UPDATE campaigns SET status='queued',scheduled_at=?,updated_at=?,queue_token=? WHERE workspace_id=? AND id=? AND status='draft' AND updated_at=? AND name=? AND subject=? AND preheader=? AND body=? AND category=? AND audience_tag=? AND locale=?",
            scheduled,
            now(),
            queueToken,
            w,
            id,
            camp.updated_at,
            camp.name,
            camp.subject,
            camp.preheader,
            camp.body,
            camp.category,
            camp.audience_tag,
            campaignLocale(camp),
          ),
          ...a.yes.map((d) =>
            q(
              c,
              "INSERT INTO deliveries(id,workspace_id,campaign_id,contact_id,email,name,status,updated_at) SELECT ?,?,?,?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM campaigns WHERE workspace_id=? AND id=? AND queue_token=?)",
              uuid(),
              w,
              id,
              d.id,
              d.email,
              d.name,
              now(),
              w,
              id,
              queueToken,
            ),
          ),
          q(
            c,
            "INSERT INTO audit(id,workspace_id,actor,action,detail,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM campaigns WHERE workspace_id=? AND id=? AND queue_token=?)",
            uuid(),
            w,
            user.email,
            "campaign.queued",
            `${camp.name}: ${a.yes.length} người nhận`,
            now(),
            w,
            id,
            queueToken,
          ),
        ];
        try {
          await c.db.batch(updates);
        } catch {
          throw new Problem(
            409,
            "Chiến dịch đã thay đổi. Tải lại để kiểm tra.",
          );
        }
        const claimed = await q(
          c,
          "SELECT queue_token FROM campaigns WHERE workspace_id=? AND id=?",
          w,
          id,
        ).first();
        if (claimed?.queue_token !== queueToken)
          throw new Problem(
            409,
            "Nội dung hoặc trạng thái đã thay đổi khi xếp hàng. Tải lại để kiểm tra.",
          );
        return json({ queued: a.yes.length, delivery: readiness(c, locale) });
      }
      if (action === "cancel" && method === "POST") {
        if (camp.status !== "queued")
          throw new Problem(409, "Chiến dịch không ở hàng đợi");
        await c.db.batch([
          q(
            c,
            "UPDATE campaigns SET status='cancelled',updated_at=? WHERE workspace_id=? AND id=? AND status='queued'",
            now(),
            w,
            id,
          ),
          q(
            c,
            "UPDATE deliveries SET status='skipped',error='Chiến dịch đã hủy',updated_at=? WHERE workspace_id=? AND campaign_id=? AND status='pending'",
            now(),
            w,
            id,
          ),
          audit(c, w, "campaign.cancelled", camp.name),
        ]);
        return json({ ok: true });
      }
      if (action === "process" && method === "POST") {
        await authorize(c, w, true, true);
        return json(await processCampaign(c, w, id, locale));
      }
    }
    if (resource === "forms" && method === "POST" && !id) {
      const p = z
        .object({
          name: z.string().trim().min(2).max(100),
          tag: z.string().trim().max(100).default(""),
          consentSource: z.string().trim().min(3).max(300),
          locale: z
            .enum(LOCALE_CODES as [LocaleCode, ...LocaleCode[]])
            .default("vi"),
          slug: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-z0-9][a-z0-9-]{2,40}$/)
            .optional(),
        })
        .parse(await body(req));
      const slug =
        p.slug ||
        `${p.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 24)}-${uuid().slice(0, 6)}`;
      const fid = uuid();
      try {
        await c.db.batch([
          q(
            c,
            "INSERT INTO signup_forms(id,workspace_id,slug,name,tag,locale,consent_source,active,created_at) VALUES(?,?,?,?,?,?,?,1,?)",
            fid,
            w,
            slug,
            p.name,
            p.tag,
            p.locale,
            p.consentSource,
            now(),
          ),
          audit(c, w, "form.created", `${p.name} (${slug})`),
        ]);
      } catch {
        throw new Problem(409, "Đường dẫn biểu mẫu đã tồn tại");
      }
      return json({ id: fid, slug }, 201);
    }
    if (resource === "forms" && id && method === "DELETE") {
      const found = await q(
        c,
        "SELECT id FROM signup_forms WHERE workspace_id=? AND id=?",
        w,
        id,
      ).first();
      if (!found) throw new Problem(404, "Không tìm thấy biểu mẫu");
      await c.db.batch([
        q(c, "DELETE FROM signup_forms WHERE workspace_id=? AND id=?", w, id),
        audit(c, w, "form.deleted", id),
      ]);
      return json({ ok: true });
    }
    if (resource === "dkim" && method === "POST") {
      const p = z
        .object({
          domain: z.string().trim().toLowerCase().max(253),
          selector: z.string().trim().toLowerCase().max(63).default("nep"),
          bits: z.union([z.literal(1024), z.literal(2048)]).default(2048),
        })
        .parse(await body(req));
      if (!domainOk(p.domain)) throw new Problem(400, "Tên miền không hợp lệ");
      if (!selectorOk(p.selector))
        throw new Problem(400, "Selector không hợp lệ");
      const key = await generateDkimKey(p.selector, p.domain, p.bits);
      await audit(
        c,
        w,
        "dkim.generated",
        `${p.selector}._domainkey.${p.domain}`,
      ).run();
      return json({ ...key, txt: txtChunks(key.dnsValue) });
    }
    if (resource === "dns" && method === "GET") {
      const domain = (url.searchParams.get("domain") || "")
        .trim()
        .toLowerCase();
      const selector = (url.searchParams.get("selector") || "nep")
        .trim()
        .toLowerCase();
      if (!domainOk(domain)) throw new Problem(400, "Tên miền không hợp lệ");
      if (!selectorOk(selector))
        throw new Problem(400, "Selector không hợp lệ");
      try {
        return json(await checkDomain(domain, selector));
      } catch {
        throw new Problem(502, "Không tra được DNS. Vui lòng thử lại.");
      }
    }
    if (resource === "keys" && method === "POST" && !id) {
      const p = z
        .object({
          name: z.string().trim().min(2).max(80),
          source: z.enum(["nep_hr", "nep_business", "custom"]),
        })
        .parse(await body(req));
      const token = `nep_${uuid().replaceAll("-", "")}${uuid().replaceAll("-", "")}`;
      await c.db.batch([
        q(
          c,
          "INSERT INTO integration_keys(id,workspace_id,name,digest,source,created_at) VALUES(?,?,?,?,?,?)",
          uuid(),
          w,
          p.name,
          await sha256(token),
          p.source,
          now(),
        ),
        audit(c, w, "key.created", p.name),
      ]);
      return json({ token }, 201);
    }
    if (resource === "keys" && id && method === "DELETE") {
      await c.db.batch([
        q(
          c,
          "UPDATE integration_keys SET revoked_at=? WHERE workspace_id=? AND id=?",
          now(),
          w,
          id,
        ),
        audit(c, w, "key.revoked", id),
      ]);
      return json({ ok: true });
    }
    if (resource === "members" && method === "POST") {
      const p = z
        .object({
          email: emailSchema,
          role: z.enum(["admin", "editor", "viewer"]),
        })
        .parse(await body(req));
      await c.db.batch([
        q(
          c,
          "INSERT INTO members(id,workspace_id,email,role) VALUES(?,?,?,?) ON CONFLICT(workspace_id,email) DO UPDATE SET role=excluded.role WHERE members.email<>?",
          uuid(),
          w,
          p.email,
          p.role,
          user.email.toLowerCase(),
        ),
        audit(c, w, "member.saved", `${p.email}: ${p.role}`),
      ]);
      return json({ ok: true });
    }
    if (resource === "demo" && method === "POST") {
      await authorize(c, w, true, true);
      const exists = await q(
        c,
        "SELECT id FROM contacts WHERE workspace_id=? LIMIT 1",
        w,
      ).first();
      if (exists) throw new Problem(409, "Chỉ tạo mẫu trong workspace trống");
      const samples = [
        ["Nguyễn Minh Anh", "minhanh", "khach-hang", true],
        ["Trần Quốc Huy", "quochuy", "khach-hang", true],
        ["Lê Thu Hà", "thuha", "nhan-su", false],
        ["Phạm Gia Bảo", "giabao", "khach-hang", false],
        ["Võ Ngọc Linh", "ngoclinh", "nhan-su", true],
        ["Đặng Hoàng Nam", "hoangnam", "khach-hang", true],
      ];
      await c.db.batch([
        ...samples.map(([name, email, tags, consent]) =>
          contactInsert(c, w, {
            name: String(name),
            email: `${email}@example.invalid`,
            tags: String(tags),
            consent: !!consent,
            consentSource: "Dữ liệu tổng hợp để thử nghiệm",
          }),
        ),
        audit(
          c,
          w,
          "demo.created",
          "6 liên hệ tổng hợp, không gửi ra Internet",
        ),
      ]);
      return json({ ok: true });
    }
    throw new Problem(404, "Không tìm thấy API");
  } catch (e) {
    if (e instanceof Problem)
      return json({ error: translate(locale, e.message) }, e.status);
    if (e instanceof z.ZodError)
      return json(
        {
          error: e.issues.map((v) => translate(locale, v.message)).join("; "),
        },
        400,
      );
    console.error(
      "nep_mail_request_failed",
      e instanceof Error ? e.name : "unknown",
    );
    return json(
      { error: "Không thể hoàn tất yêu cầu. Vui lòng thử lại." },
      500,
    );
  }
}
