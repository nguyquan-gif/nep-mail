import { z } from "zod";
import { LOCALE_CODES, localeTag, translate, type LocaleCode } from "./i18n.ts";
export class Problem extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine((v) => !/[\r\n\x00]/.test(v), "Không được chứa ký tự xuống dòng");
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const contactSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(1).max(160),
    tags: z.string().trim().max(300).default(""),
    consent: z.boolean().default(false),
    consentSource: z.string().trim().max(500).default(""),
  })
  .refine(
    (c) => !c.consent || c.consentSource.length >= 3,
    "Cần ghi nguồn đồng ý nhận email",
  );
export const campaignSchema = z.object({
  name: line(160),
  subject: line(200),
  preheader: z.string().trim().max(300).default(""),
  body: z.string().trim().min(10).max(50000),
  category: z.enum(["marketing", "internal"]).default("marketing"),
  audienceTag: z.string().trim().max(100).default(""),
  locale: z.enum(LOCALE_CODES as [LocaleCode, ...LocaleCode[]]).default("vi"),
});
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function personalize(
  text: string,
  p: { name: string; email: string },
): string {
  return text.replace(
    /\{\{\s*(name|first_name|email)\s*\}\}/g,
    (_, key: string) =>
      key === "email"
        ? p.email
        : key === "first_name"
          ? p.name.trim().split(/\s+/).at(-1) || "bạn"
          : p.name,
  );
}
export function renderEmail(
  c: { subject: string; body: string; preheader?: string },
  p: { name: string; email: string },
  brand: string,
  unsubscribe: string,
  locale: LocaleCode = "vi",
) {
  const text = personalize(c.body, p),
    subject = personalize(c.subject, p).replace(/[\r\n]/g, " ");
  const footer = translate(locale, "email.footer", { brand });
  const optOut = translate(locale, "email.unsubscribe");
  const html = `<!doctype html><html lang="${localeTag(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f3f5f2;font-family:Arial,sans-serif;color:#20392e"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(c.preheader || "")}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:32px 16px"><table role="presentation" style="max-width:600px;margin:auto;background:#fff;width:100%;border-collapse:collapse"><tr><td style="padding:32px;border-bottom:1px solid #e4e8e4;font-size:20px;font-weight:bold">${escapeHtml(brand)}</td></tr><tr><td style="padding:32px;font-size:16px;line-height:1.7">${text
    .split(/\n\s*\n/)
    .map(
      (t) =>
        `<p style="margin:0 0 20px">${escapeHtml(t).replace(/\n/g, "<br>")}</p>`,
    )
    .join(
      "",
    )}</td></tr><tr><td style="padding:24px 32px;background:#f7f8f5;font-size:12px;color:#596960">${escapeHtml(footer)}<br><a style="color:#235642" href="${escapeHtml(unsubscribe)}">${escapeHtml(optOut)}</a></td></tr></table></td></tr></table></body></html>`;
  return {
    html,
    text: `${text}\n\n${translate(locale, "email.textFooter", { url: unsubscribe })}`,
    subject,
  };
}
export function parseCsv(input: string): string[][] {
  if (input.length > 500000) throw new Problem(413, "Tệp CSV tối đa 500 KB");
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false;
  const s = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (quoted && s[i + 1] === '"') {
        value += '"';
        i++;
      } else if (!quoted && value !== "")
        throw new Problem(400, "CSV có dấu ngoặc kép không hợp lệ");
      else quoted = !quoted;
    } else if (!quoted && c === ",") {
      row.push(value);
      value = "";
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(value);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Problem(400, "CSV chưa đóng dấu ngoặc kép");
  row.push(value);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length > 501)
    throw new Problem(400, "Mỗi lần nhập tối đa 500 liên hệ");
  return rows;
}
export function importContacts(csv: string) {
  const [header, ...rows] = parseCsv(csv);
  if (!header) throw new Problem(400, "CSV trống");
  const names = header.map((h) => h.trim().toLowerCase());
  if (!names.includes("email") || !names.includes("name"))
    throw new Problem(400, "CSV cần cột email và name");
  if (new Set(names).size !== names.length)
    throw new Problem(400, "Tên cột CSV bị trùng");
  return rows.map((r, i) => {
    if (r.length !== names.length)
      throw new Problem(400, `Dòng ${i + 2}: số cột không khớp`);
    const obj = Object.fromEntries(names.map((h, j) => [h, r[j]]));
    const consent = (obj.consent || "false").trim().toLowerCase();
    if (!["true", "false", "1", "0"].includes(consent))
      throw new Problem(400, `Dòng ${i + 2}: consent phải là true hoặc false`);
    const p = contactSchema.safeParse({
      ...obj,
      consent: ["true", "1"].includes(consent),
      consentSource: obj.consent_source || "",
    });
    if (!p.success)
      throw new Problem(400, `Dòng ${i + 2}: ${p.error.issues[0].message}`);
    return p.data;
  });
}
export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export async function sha256(v: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function b64(a: Uint8Array) {
  return btoa(String.fromCharCode(...a))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
async function hmac(s: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(s),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
/** Sign an arbitrary payload (used for e-mail confirmation links). */
export async function signPayload(
  secret: string,
  payload: string,
): Promise<string> {
  const body = b64url(new TextEncoder().encode(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmac(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${b64url(new Uint8Array(signature))}`;
}
/** Verify and return the payload, or null when tampered with. */
export async function verifyPayload(
  secret: string,
  token: string,
): Promise<string | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || token.length > 800) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmac(secret),
      fromB64url(signature),
      new TextEncoder().encode(body),
    );
    return ok ? new TextDecoder().decode(fromB64url(body)) : null;
  } catch {
    return null;
  }
}
export async function unsubscribeToken(
  secret: string,
  workspace: string,
  contact: string,
) {
  const p = `${workspace}.${contact}`;
  return `${p}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", await hmac(secret), new TextEncoder().encode(p))))}`;
}
export async function verifyUnsubscribe(secret: string, token: string) {
  const [workspace, contact, signature, extra] = token.split(".");
  if (!workspace || !contact || !signature || extra || token.length > 300)
    return null;
  try {
    const b = Uint8Array.from(
      atob(signature.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
    return (await crypto.subtle.verify(
      "HMAC",
      await hmac(secret),
      b,
      new TextEncoder().encode(`${workspace}.${contact}`),
    ))
      ? { workspace, contact }
      : null;
  } catch {
    return null;
  }
}
