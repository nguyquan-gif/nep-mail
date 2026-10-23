# Launch kit

Everything needed to publish the repository, in order. Nothing here assumes a
paid service.

## 0. Before the repo goes public

- [ ] Confirm no secrets in history: `git log -p | grep -iE "secret|password|nep_"`.
      A single leaked `SESSION_SECRET` invalidates every session; rotate and
      rewrite history rather than "fixing" it in a later commit.
- [x] `LICENSE` (AGPL-3.0) and `NOTICE` at the root; `package.json` says
      `AGPL-3.0-or-later`.
- [x] CI green on the default branch (`.github/workflows/ci.yml` runs typecheck,
      build, 53 tests and a real `docker compose` smoke test).
- [x] Repository description and topics:
      `email-marketing`, `newsletter`, `self-hosted`, `smtp`, `sqlite`, `brevo`,
      `double-opt-in`, `gdpr`, `dkim`, `docker`, `mailchimp-alternative`,
      `vietnamese`, `agpl`. Discussions enabled.
- [ ] Social preview image: upload [`social-preview.png`](social-preview.png)
      (1280×640) in GitHub → Settings → General → Social preview. There is no
      API for this; until it is uploaded, shared links show GitHub's default card.
- [x] Publish a GitHub **Release**, not only a tag: `v0.4.0-alpha.1`, marked
      pre-release. awesome-selfhosted counts its four months from the first
      Release (section 5).
- [x] Release notes repeat the honest limits: alpha, no inbox guarantee,
      Docker-verified but not security-audited.

## 1. Donations

Do this before announcing; a repo with no way to give is a missed wave.

- [ ] GitHub Sponsors (needs a verified bank/tax profile; takes days). The
      `github:` handle is already in `FUNDING.yml` and switches on once approved.
- [x] `.github/FUNDING.yml` with PayPal and the sponsor page, plus a "Keep it
      free" section in the README. Alternatives that work from Vietnam: Ko-fi,
      Buy Me a Coffee, Polar, Open Collective (needs a fiscal host).
- [x] Say what money buys: [SPONSOR.md](SPONSOR.md). Do not promise features for
      donations.

Reality check: donations run at roughly 0.1–1% of active users. Ten thousand
stars is not ten thousand dollars. Traffic and a real use case come first.

## 2. Vietnamese communities first

The one thing no foreign tool offers is a Vietnamese-first interface with consent
stored as evidence. Start where that matters, collect the first bug reports, and
fix them before the English-language launch.

- Write one real tutorial on Viblo ("Tự gửi bản tin cho 5.000 người với Nếp
  Mail + DKIM trong 30 phút") instead of ten announcements. Share the tutorial,
  not a bare repository link.
- Facebook groups for WordPress/WooCommerce/Magento shop owners: the hook is
  "không trả phí theo số liên hệ, dữ liệu khách hàng nằm trên máy mình, có bằng
  chứng đồng ý" (Nghị định 13/2023).
- Dev communities (Viblo, DevOps groups, the programming board on voz): the hook
  is the architecture — SQLite + conditional claims + one compose file — and the
  Brevo relay for VPS plans that block port 25.
- One group per day, each post written for that group.

## 3. Show HN

Post after the first round of fixes, Tuesday–Thursday, 19:00–21:00
Asia/Ho_Chi_Minh (morning in US Eastern).

Title (keep it literal):

```
Show HN: Nếp Mail – self-hosted email campaigns with double opt-in and no tracking
```

Body:

```
I kept meeting small teams who run their newsletter out of a spreadsheet and a
Gmail BCC, because Mailchimp got expensive and nobody wanted to migrate a list
into another SaaS.

Nếp Mail is the tool I wanted: one Docker compose file, SQLite, your own SMTP
relay. Postgres and Redis are not involved.

What it does that mattered to me:

- Consent is stored as data: source, timestamp, and a pending→active transition
  that only happens after the recipient clicks a signed link. Imports never
  resurrect an unsubscribe.
- Public signup form per workspace (no account for the subscriber), honeypot and
  rate limit, one-click unsubscribe with RFC 8058 headers.
- SPF/DKIM/DMARC checks over DNS-over-HTTPS and an in-app DKIM key generator, so
  you find out your DNS is broken before you send 5,000 messages.
- Hard bounces and complaints suppress themselves, from raw DSN/ARF reports, a
  provider webhook, or an IMAP mailbox.
- No port 25? An HTTP relay adapter sends through Brevo's API and takes bounces
  by webhook.
- No tracking pixels, no link rewriting.

Ten interface languages; Vietnamese is the source language, English and the rest
are community-grade translations (corrections welcome).

It is an alpha: 53 tests, Docker verified on Windows and Linux, but no security
audit, no live SMTP/PTR validation on an owned domain yet, no visual template
editor. AGPL-3.0.

Happy to answer anything about the queueing model — the interesting part is that
the audience is snapshotted at queue time and each send is claimed atomically, so
a crash leaves an `unknown` row for a human instead of a duplicate email.
```

Have these answers ready; they will be asked in the first hour:

- **Why not listmonk or Keila?** Both are more mature; if one already works for
  you, keep it. Nếp Mail trades scale for a single SQLite file, consent
  provenance as a record, built-in DNS/DKIM checks, a relay path for blocked
  port 25, and a Vietnamese-first interface.
- **Why AGPL?** The licence section of the README; do not argue past it.
- **Will my mail reach the inbox?** No promise. Link
  [DELIVERABILITY.md](DELIVERABILITY.md).

Rules for the day: answer every comment for the first six hours, ship one small
fix visibly, and never argue about the licence. Never ask friends to upvote: HN
detects voting rings and buries the post.

## 4. r/selfhosted and directories

- r/selfhosted — title:
  `Nếp Mail: self-hosted email campaigns (Docker + SQLite, double opt-in, no tracking)`.
  Read the subreddit's current self-promotion rules first. Lead with the stack
  and the screenshot, list limits honestly, link the compose file, mention AGPL.
  Do not cross-post the same text to five subreddits in an hour.
- [selfh.st](https://selfh.st/) — submit the project to the weekly newsletter.
- [AlternativeTo](https://alternativeto.net/) — list it as an alternative to
  Mailchimp and listmonk.
- dev.to — an English version of the Viblo tutorial.

## 5. awesome-selfhosted

**Not before 23 February 2027.** The list requires the first Release (a tag
alone does not count) to be more than four months old; `v0.4.0-alpha.1` was
published on 23 October 2026. Submissions are now one YAML file in
`software/` of
[awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data),
not a line in the README. Entry:

```yaml
name: Nếp Mail
website_url: https://github.com/nguyquan-gif/nep-mail
description: Email campaign manager with consent provenance, double opt-in signup forms, SPF/DKIM/DMARC checks and bounce suppression, running on SQLite with your own SMTP relay.
licenses:
  - AGPL-3.0
platforms:
  - Nodejs
  - Docker
tags:
  - Communication - Email - Mailing Lists and Newsletters
source_code_url: https://github.com/nguyquan-gif/nep-mail
```

Add `demo_url` once a public demo exists. Read that repository's
`CONTRIBUTING.md` first: one entry per PR, no redundant words such as "free" or
"self-hosted" in the description.

## 6. After launch

- Turn the first five bug reports into a 0.4.1 within a week; momentum is
  perishable.
- Publish the public roadmap as issues, not prose; label translation fixes
  `good first issue`.
- Keep a `CHANGELOG.md` from the first release; contributors read it.
- If a hosting provider offers a free tier for open source, take the demo — a
  live instance converts better than any screenshot.
