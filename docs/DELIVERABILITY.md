# Deliverability: domain readiness, DKIM and bounces

Software cannot make an email land in an inbox. These three features remove the
most common self-hosting mistakes; the rest is domain reputation and content.

## 1. Check the domain before enabling live sending

Settings → **Tên miền & DNS** performs live DNS-over-HTTPS lookups for the sending
domain and reports four records:

| Record | What is checked                                                       | Blocks sending |
| ------ | --------------------------------------------------------------------- | -------------- |
| MX     | The domain can receive mail (postmaster, bounces, replies)            | no (warning)   |
| SPF    | Exactly one `v=spf1` record, ending in `-all` or `~all`               | yes            |
| DKIM   | `v=DKIM1` present at `<selector>._domainkey.<domain>` with a real key | yes            |
| DMARC  | `v=DMARC1` present; `p=none` is only a warning                        | no if `p=none` |

`ready: true` means nothing is _broken_, not that mail will be delivered. The
verdicts are computed in `src/core/dns.ts`, which takes an injectable fetch, so
the tests exercise the real parsing logic without touching the network.

## 2. Generate a DKIM key

Settings → **Tạo khoá DKIM** generates an RSA-2048 key pair in the browser/server
runtime with WebCrypto (`src/core/dkim.ts`) and returns:

- the TXT record value (`v=DKIM1; k=rsa; p=…`), split ready for zone files;
- the record name (`nep._domainkey.your-domain.vn`);
- the private key in PEM, offered as a download.

Nothing is stored in the database: the private key exists in that response only.
Save it as `dkim.key` next to `compose.direct.yaml`, or wherever
`DKIM_PRIVATE_KEY_FILE` points, and keep the file out of version control
(`.gitignore` already excludes `*.key` and `*.pem`).

Publish the TXT record, restart the stack, then re-run the domain check — DKIM
should move from _missing_ to _OK_.

## 3. Ingest bounces and complaints

A hard bounce or a spam complaint that keeps receiving mail is how a domain
loses its reputation. `POST /api/v1/bounces` accepts either a raw RFC 3464 DSN /
RFC 5965 ARF message or a parsed event:

```sh
curl -sS https://mail.example.vn/api/v1/bounces \
  -H "authorization: Bearer nep_…" \
  -H "content-type: application/json" \
  -d '{"email":"gone@example.com","kind":"hard","diagnostic":"550 5.1.1"}'
# → {"received":1,"suppressed":1}
```

```sh
# whole mailbox dump / Maildir folder of DSNs
NEP_MAIL_URL=https://mail.example.vn NEP_MAIL_KEY=nep_… \
  node scripts/bounces.mjs ./bounces
```

Rules enforced server-side:

- `kind: "hard"` and `"complaint"` set the contact to `suppressed` and clear
  consent, permanently for that address.
- `kind: "soft"` is recorded in the audit log but never suppresses — temporary
  failures are normal.
- Addresses that are not in the workspace are ignored; this endpoint cannot
  create contacts.
- Parsing lives in `src/core/bounce.ts` and is covered by tests with real DSN
  and ARF samples.

Point your MTA's `postmaster`/`double-bounce` alias at a mailbox, then run the
script from cron (or forward those messages to a small relay that posts the raw
body). The API is deliberately transport-agnostic: IMAP, Maildir, a provider
webhook or a forwarder all work.

## 4. Read the bounce mailbox over IMAP

If your bounce mailbox lives on Gmail, Zoho, Mailcow or any other IMAP server,
the app can read it itself — no cron, no forwarder:

```ini
BOUNCE_IMAP_HOST=imap.example.vn
BOUNCE_IMAP_PORT=993
BOUNCE_IMAP_SECURE=true
BOUNCE_IMAP_USER=bounce@example.vn
BOUNCE_IMAP_PASS=app-password-here
BOUNCE_IMAP_MAILBOX=INBOX
BOUNCE_IMAP_INTERVAL=60
# Optional: restrict suppression to one workspace id
# BOUNCE_WORKSPACE=
```

Behaviour, in order:

1. Every `BOUNCE_IMAP_INTERVAL` seconds the poller connects, takes a mailbox
   lock, and searches for **unseen** messages (newest 25 per tick).
2. Each message is parsed with the same `parseBounce()` used by the HTTP
   endpoint. Unrelated mail is ignored — but still marked `\Seen`, so it is not
   re-read on the next tick.
3. Hard bounces and complaints suppress the address everywhere on the instance
   (or only in `BOUNCE_WORKSPACE`), and write an audit row attributed to `imap`.
4. Soft bounces are counted and dropped; nothing is suppressed.
5. A failed connection is logged (`bounce_poll_failed`) and retried on the next
   tick. It never crashes the server or blocks campaign processing.

Use an app password, not the account password, and give the mailbox its own
account: the poller only needs IMAP read + flag access. A restart does not replay
old mail because processed messages are flagged seen; a crash between flagging
and suppressing is the only way an event is lost, and the next bounce for that
address will cover it.

### Checking a real mailbox first

`scripts/imap-check.mjs` connects with the same settings the poller uses and has
three modes. Credentials live in a local file, never in chat or in the repo:

```ini
# .env.bounce-test  (already gitignored)
BOUNCE_IMAP_HOST=imap.gmail.com
BOUNCE_IMAP_PORT=993
BOUNCE_IMAP_SECURE=true
BOUNCE_IMAP_USER=you@gmail.com
BOUNCE_IMAP_PASS=app-password-here
```

```sh
node --env-file=.env.bounce-test scripts/imap-check.mjs --list   # auth, TLS, folders
node --env-file=.env.bounce-test scripts/imap-check.mjs --scan   # read-only report
NEP_MAIL_URL=https://mail.example.vn NEP_MAIL_KEY=nep_… \
  node --env-file=.env.bounce-test scripts/imap-check.mjs --apply
```

`--scan` prints kind, masked address, SMTP status and subject; it flags nothing
and sends nothing. `--apply` posts each raw message to `/api/v1/bounces` and only
then marks it seen, so a failed POST is retried on the next run.

Gmail notes, from a verified run: enable 2-Step Verification, create an **App
password** (16 characters, paste it without spaces), and leave IMAP enabled.
Gmail lists folders under `[Gmail]/…` and **localises their names** to the account
language (`[Gmail]/Thư đã gửi`, `[Gmail]/Tất cả thư`), so match on the special-use
flag or rename the label you filter into. Use a **dedicated account**: the poller
marks every unseen message seen, including personal mail. A Gmail filter that
moves DSNs into a label, plus `BOUNCE_IMAP_MAILBOX=<label>`, keeps it contained.

Zoho notes: `imap.zoho.com:993`, and IMAP must be enabled under Settings → Mail
Accounts. **The free plan does not include IMAP/POP** for new sign-ups; Zoho
answers a disabled account with "You are yet to enable IMAP for your account".

Generating a bounce to test with is harder than it looks: an address that does
not exist usually fails **synchronously** at RCPT, so your own client sees the
550 and no DSN is ever generated. A DSN only exists when a server _accepts_ the
message and bounces it later. Practical options:

- Send to a real address on a domain whose mailbox is full or disabled.
- Send through the Postfix in `compose.direct.yaml` to a domain that accepts then
  bounces; the DSN lands in the local `postmaster` mailbox.
- For pipeline testing only, deliver a standards-shaped DSN (multipart/report +
  `message/delivery-status`) to the mailbox over SMTP; the poller cannot tell the
  difference, and this is how `scripts/imap-check.mjs` was verified against Gmail.

Note: `bounce@simulator.amazonses.com` only answers **SES senders**. From any
other MTA the message is accepted silently and no DSN comes back.

### Verifying the poller without your own mail

`scripts/imap-e2e.mjs` runs the whole path against a throwaway IMAP server:

```sh
docker run -d --name nep-greenmail --user 0:0 --entrypoint /bin/sh \
  -p 3025:3025 -p 3143:3143 greenmail/standalone:latest \
  -c 'exec /home/greenmail/run_greenmail.sh'
node scripts/imap-e2e.mjs     # → E2E PASS
docker rm -f nep-greenmail
```

It creates a workspace and contact, delivers a DSN over SMTP, polls over IMAP,
asserts the contact became `suppressed` with an audit row from `imap`, and that a
second poll reads nothing. Hosts and ports can be overridden with `E2E_SMTP_HOST`,
`E2E_SMTP_PORT`, `E2E_IMAP_HOST`, `E2E_IMAP_PORT`, `E2E_IMAP_USER`.

## Free path: HTTP relay + webhook (no VPS, no port 25)

Most people cannot send from their own IP: port 25 is blocked, the address is
dynamic, and reputation starts at zero. The relay adapter sends through a
provider's HTTP API instead, and the provider reports bounces to a webhook — so
there is no MTA, no mailbox and no IMAP to configure.

```ini
RELAY_PROVIDER=brevo
RELAY_API_KEY=xkeysib-…
MAIL_FROM=newsletter@your-domain.vn      # must be verified at the provider
MAIL_FROM_NAME=Nếp Mail
RELAY_WEBHOOK_SECRET=<32+ random characters>
LIVE_SEND=true
CAPTURE_MODE=false
```

Brevo, from zero:

1. Create an account, then **Senders & Domains → Domains → Add a domain** and
   publish the DKIM/SPF records Brevo shows. The provider signs for your domain,
   so `DKIM_PRIVATE_KEY_FILE` is not used in this mode.
2. **SMTP & API → API Keys → Create**, copy the `xkeysib-…` key into
   `RELAY_API_KEY`.
3. **Transactional → Settings → Webhooks → Add**, URL:
   `https://your-app/api/v1/webhooks/brevo?token=<RELAY_WEBHOOK_SECRET>`,
   events: `hardBounce`, `softBounce`, `spam`, `invalid`, `blocked`,
   `deferred` (Brevo uses camelCase; the adapter also accepts snake_case). Generate the secret with `openssl rand -hex 32`.
4. Restart the app. Readiness now needs only an HTTPS origin, `MAIL_FROM` and a
   public unsubscribe URL — the DKIM/MX checks belong to the provider.
5. Send a campaign to a deliberately broken address and watch the audit log; the
   contact flips to `suppressed` from the webhook, not from a mailbox.

What the webhook does: maps `hardBounce`/`softBounce`/`spam` to `hard` / `soft` /
`complaint`, suppresses hard failures and complaints **instance-wide**, ignores
soft bounces and refuses to create contacts or grant consent. The shared secret
travels in the URL because Brevo does not sign payloads; the endpoint rejects a
missing or wrong token and is useless without it.

Trade-offs, stated plainly:

- Free tiers are small (Brevo ≈300 recipients/day, Mailjet ≈200, Resend ≈100 —
  check current terms before planning volume) and marketing use may need the
  provider's approval.
- The provider owns IP reputation, so a suspension stops your sending.
- It is no longer "no third party". Direct SMTP (`RELAY_PROVIDER` unset) remains
  the path that keeps everything on your own infrastructure.

Adding another provider means editing the two registries in
`src/core/relay.ts` (request builder + response reader) and the event map; the
campaign, queue and suppression code is untouched.

## What a real Gmail inbox reported

Read back over IMAP from a Gmail mailbox on 2026-10-23, sending through the
relay adapter with `From: xinchao@sayhellovietnam.com`:

```
Authentication-Results: mx.google.com;
  dkim=pass header.i=@sayhellovietnam.com header.s=brevo2;
  spf=pass (…) smtp.mailfrom=bounces-…@gx.d.sender-sib.com
DKIM-Signature: d=sayhellovietnam.com; s=brevo2; h=from:subject:…:list-unsubscribe:list-unsubscribe-post:…
List-Unsubscribe: <https://…/api/unsubscribe?token=…>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
Return-Path: <bounces-…@gx.d.sender-sib.com>
```

Reading that correctly:

- **DKIM passes and is aligned** to the From domain, so DMARC passes on DKIM
  alignment even though…
- **SPF passes on Brevo's envelope domain**, not on yours (`gx.d.sender-sib.com`).
  That is normal for a relay and does not need fixing: adding
  `include:spf.brevo.com` to your own SPF only matters if you later send with
  your own bounce domain (`Return-Path` on your domain).
- The standard unsubscribe headers survive the provider and are signed, so
  Gmail's one-click opt-out works.
- `p=none` in DMARC means nobody enforces anything. Move to
  `p=quarantine` once the reports look clean.

Landing in Spam with that header set is a **reputation** problem, not an
authentication one: a new domain on a shared relay IP, first messages, low
engagement. What actually moves it: send to people who expect the mail, ask them
to mark "not spam" and reply, keep volume low and steady, and never send a
placeholder `List-Unsubscribe` (`https://example.invalid/…`) — a dead opt-out URL
is a spam signal. The check script now omits the header when no real URL exists.

## What is still yours to operate

- Outbound port 25, a static IP and matching PTR record.
- A warm-up schedule: volume ramps slowly over weeks, not days.
- Complaint-rate monitoring and a human address for abuse reports.
- Content that people actually asked to receive.
