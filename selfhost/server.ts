import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { SqliteDatabase } from "./database.ts";
import { smtpTransport } from "./smtp.ts";
import { session, verifySession, passwordMatches } from "./auth.ts";
import { handleApi, processCampaign } from "../src/core/api.ts";
import { createBouncePoller, imapOptionsFromEnv } from "./imap.ts";
import {
  isRelayProvider,
  relayTransport,
  type RelayProvider,
} from "../src/core/relay.ts";
import type { Context } from "../src/core/types.ts";
import {
  bestLocale,
  localeTag,
  translate,
  type LocaleCode,
} from "../src/core/i18n.ts";
import { escapeHtml } from "../src/core/domain.ts";
const data = resolve(process.env.DATA_DIR || "data");
mkdirSync(data, { recursive: true });
const db = new SqliteDatabase(resolve(data, "nep-mail.sqlite"));
db.migrate(resolve("drizzle"));
const origin = new URL(process.env.APP_ORIGIN || "http://localhost:3000")
  .origin;
const secret = process.env.SESSION_SECRET || "",
  password = process.env.ADMIN_PASSWORD || "";
if (
  secret.length < 32 ||
  password.length < 14 ||
  secret.startsWith("replace-") ||
  password.startsWith("replace-")
)
  throw new Error(
    "Set SESSION_SECRET (32+ chars) and ADMIN_PASSWORD (14+ chars); see .env.example",
  );
db.raw
  .prepare(
    "UPDATE deliveries SET status='unknown',error='Tiến trình dừng trong lúc gửi. Cần đối soát SMTP trước khi xử lý.',updated_at=? WHERE status='submitting'",
  )
  .run(new Date().toISOString());
const live = process.env.LIVE_SEND === "true",
  capture = process.env.CAPTURE_MODE !== "false";
if (live && capture)
  throw new Error("Set CAPTURE_MODE=false explicitly before LIVE_SEND=true");
// A relay sends through a provider's HTTP API: no port 25, no DKIM key here
// (the provider signs for the verified domain), bounces arrive by webhook.
const relayProvider = process.env.RELAY_PROVIDER || "";
if (relayProvider && !isRelayProvider(relayProvider))
  throw new Error("RELAY_PROVIDER must be one of: brevo");
const relayEnabled = isRelayProvider(relayProvider);
if (relayEnabled && !process.env.RELAY_API_KEY)
  throw new Error("RELAY_API_KEY is required when RELAY_PROVIDER is set");
if (
  live &&
  (!process.env.MAIL_FROM ||
    !process.env.PUBLIC_UNSUBSCRIBE_ORIGIN ||
    origin.startsWith("http:"))
)
  throw new Error(
    "Live send requires an HTTPS APP_ORIGIN, MAIL_FROM and PUBLIC_UNSUBSCRIBE_ORIGIN",
  );
if (
  live &&
  !relayEnabled &&
  (!process.env.DKIM_PRIVATE_KEY_FILE || !process.env.MAIL_DOMAIN)
)
  throw new Error(
    "Direct SMTP requires MAIL_DOMAIN and DKIM_PRIVATE_KEY_FILE; set RELAY_PROVIDER to send through an HTTP relay instead",
  );
if (
  live &&
  !relayEnabled &&
  (!/^[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}$/i.test(process.env.MAIL_FROM || "") ||
    process.env.MAIL_FROM!.split("@")[1] !== process.env.MAIL_DOMAIN ||
    /\.(invalid|test|localhost)$/.test(process.env.MAIL_DOMAIN || ""))
)
  throw new Error(
    "Live MAIL_FROM must be a real address aligned with MAIL_DOMAIN",
  );
if (
  live &&
  relayEnabled &&
  !/^[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}$/i.test(process.env.MAIL_FROM || "")
)
  throw new Error("MAIL_FROM must be the sender verified at the relay");

const transport =
  live && relayEnabled
    ? relayTransport({
        provider: relayProvider as RelayProvider,
        apiKey: process.env.RELAY_API_KEY!,
        sender: {
          email: process.env.MAIL_FROM!,
          name: process.env.MAIL_FROM_NAME || undefined,
        },
      })
    : smtpTransport({
        host: process.env.SMTP_HOST || "mailpit",
        port: Number(process.env.SMTP_PORT || 1025),
        sender: process.env.MAIL_FROM || "hello@example.invalid",
        capture,
        dkim: process.env.DKIM_PRIVATE_KEY_FILE
          ? {
              domainName: process.env.MAIL_DOMAIN!,
              keySelector: process.env.DKIM_SELECTOR || "nep",
              privateKey: readFileSync(
                process.env.DKIM_PRIVATE_KEY_FILE,
                "utf8",
              ),
            }
          : undefined,
      });
const context: Context = {
  db,
  user: {
    id: "selfhost-admin",
    email: (process.env.ADMIN_EMAIL || "admin@localhost").toLowerCase(),
    name: "Quản trị viên",
  },
  config: {
    runtime: "selfhost",
    captureAvailable: capture,
    liveEnabled: live,
    publicUnsubscribeOrigin: process.env.PUBLIC_UNSUBSCRIBE_ORIGIN,
    unsubscribeSecret: process.env.UNSUBSCRIBE_SECRET,
    relayWebhookSecret: process.env.RELAY_WEBHOOK_SECRET,
    transport,
    sender: process.env.MAIL_FROM,
  },
};
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const loginPage = (locale: LocaleCode, error = "") =>
  `<!doctype html><html lang="${localeTag(locale)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(translate(locale, "Đăng nhập Nếp Mail"))}</title><body style="font:16px system-ui,Arial,sans-serif;background:#f4f5ef;max-width:420px;margin:12vh auto;padding:24px;color:#193a2e"><h1>Nếp Mail</h1><p>${escapeHtml(translate(locale, "Không gian email của bạn."))}</p>${
    error
      ? `<p role="alert" style="color:#8b2f24">${escapeHtml(error)}</p>`
      : ""
  }<form method="post" action="/auth/login"><label>${escapeHtml(translate(locale, "Mật khẩu quản trị"))}<input style="display:block;padding:14px;width:90%;margin:12px 0" type="password" name="password" required minlength="14" autocomplete="current-password"></label><button style="padding:14px 24px;background:#234e3c;color:white;border:0">${escapeHtml(translate(locale, "Đăng nhập"))}</button></form></body></html>`;
const failedLogins = new Map<string, { n: number; until: number }>();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", origin);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const raw of req) {
      const chunk = Buffer.from(raw);
      size += chunk.length;
      if (size > 600000) {
        res.writeHead(413);
        res.end("Request too large");
        return;
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const trusted = verifySession(
      secret,
      ((req.headers.cookie || "").match(/(?:^|;\s*)nep_session=([^;]+)/) ||
        [])[1] || "",
    );
    const secure = origin.startsWith("https:") ? "; Secure" : "";
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (
      req.method === "POST" &&
      headers.get("origin") &&
      headers.get("origin") !== origin
    ) {
      res.writeHead(403);
      res.end("Cross-origin request rejected");
      return;
    }
    if (url.pathname === "/healthz" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ status: "ok", version: "0.3.0-alpha.2" }));
      return;
    }
    if (url.pathname === "/auth/login" && req.method === "POST") {
      const ip = req.socket.remoteAddress || "local";
      if (failedLogins.size > 10000) failedLogins.clear();
      let failure = failedLogins.get(ip);
      if (failure && failure.until < Date.now()) {
        failedLogins.delete(ip);
        failure = undefined;
      }
      if (failure && failure.n >= 10) {
        res.writeHead(429, { "Retry-After": "600" });
        res.end(
          translate(
            bestLocale(req.headers["accept-language"]),
            "Vui lòng thử lại sau 10 phút",
          ),
        );
        return;
      }
      const entered =
        new URLSearchParams(bytes.toString()).get("password") || "";
      if (entered.length > 512 || !passwordMatches(password, entered)) {
        failedLogins.set(ip, {
          n: (failure?.n || 0) + 1,
          until: Date.now() + 600000,
        });
        res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
        res.end(
          loginPage(
            bestLocale(req.headers["accept-language"]),
            translate(
              bestLocale(req.headers["accept-language"]),
              "Mật khẩu không đúng",
            ),
          ),
        );
        return;
      }
      failedLogins.delete(ip);
      res.writeHead(303, {
        "Set-Cookie": `nep_session=${session(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`,
        Location: "/",
      });
      res.end();
      return;
    }
    if (url.pathname === "/auth/logout" && req.method === "GET") {
      res.writeHead(303, {
        "Set-Cookie": `nep_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
        Location: "/auth/login",
      });
      res.end();
      return;
    }
    if (url.pathname === "/auth/login") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(loginPage(bestLocale(req.headers["accept-language"])));
      return;
    }
    // Pretty public URL for signup forms; handled by the public API surface.
    if (url.pathname.startsWith("/signup/"))
      url.pathname = "/api/public" + url.pathname;
    if (url.pathname.startsWith("/api/")) {
      const r = await handleApi(
        new Request(url, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method || "GET")
            ? undefined
            : bytes,
        }),
        { ...context, user: trusted ? context.user : null },
      );
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    if (!trusted) {
      res.writeHead(303, { Location: "/auth/login" });
      res.end();
      return;
    }
    let file = resolve("selfhost-dist", "." + decodeURIComponent(url.pathname));
    const root = resolve("selfhost-dist");
    // Windows compares with "\", POSIX with "/": never assume a separator.
    if (file !== root && !file.startsWith(root + sep))
      file = resolve(root, "index.html");
    if (!existsSync(file) || !extname(file)) file = resolve(root, "index.html");
    if (!existsSync(file)) {
      res.writeHead(503);
      res.end("Run npm run build:selfhost first");
      return;
    }
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control":
        extname(file) === ".html" ? "no-store" : "private, max-age=3600",
    });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(500);
    res.end("Internal server error");
  }
});
let processing = false;
const timer = setInterval(async () => {
  if (!live || processing) return;
  processing = true;
  try {
    const jobs = await db
      .prepare(
        "SELECT id,workspace_id FROM campaigns WHERE status='queued' AND scheduled_at<=? LIMIT 3",
      )
      .bind(new Date().toISOString())
      .all();
    for (const job of jobs.results)
      await processCampaign(context, job.workspace_id, job.id);
  } catch {
    console.error("queue_tick_failed");
  } finally {
    processing = false;
  }
}, 10000);
const imapOptions = imapOptionsFromEnv();
const bouncePoller = imapOptions
  ? createBouncePoller({
      options: imapOptions,
      context,
      log: (line, detail) => console.log(line, JSON.stringify(detail || {})),
    })
  : null;
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () => {
  console.log(
    `Nếp Mail listening; mode=${
      live
        ? relayEnabled
          ? `relay:${relayProvider}`
          : "direct-smtp"
        : "capture"
    }; live delivery=${live}`,
  );
  if (bouncePoller) {
    console.log(
      `Bounce IMAP poller active: ${imapOptions!.user}@${imapOptions!.host}/${imapOptions!.mailbox} every ${imapOptions!.intervalMs / 1000}s`,
    );
    bouncePoller.start();
  }
});
function shutdown() {
  clearInterval(timer);
  bouncePoller?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
