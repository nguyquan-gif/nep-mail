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

## What is still yours to operate

- Outbound port 25, a static IP and matching PTR record.
- A warm-up schedule: volume ramps slowly over weeks, not days.
- Complaint-rate monitoring and a human address for abuse reports.
- Content that people actually asked to receive.
