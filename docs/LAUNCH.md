# Launch kit

Everything needed to publish the repository, in order. Nothing here assumes a
paid service.

## 0. Before the repo goes public

- [ ] Confirm no secrets in history: `git log -p | grep -iE "secret|password|nep_"`.
      A single leaked `SESSION_SECRET` invalidates every session; rotate and
      rewrite history rather than "fixing" it in a later commit.
- [ ] `LICENSE` (AGPL-3.0) and `NOTICE` at the root; `package.json` says
      `AGPL-3.0-or-later`.
- [ ] CI green on the default branch (`.github/workflows/ci.yml` runs typecheck,
      build, 36 tests and a real `docker compose` smoke test).
- [ ] Repository description and topics:
      `email-marketing`, `newsletter`, `self-hosted`, `smtp`, `sqlite`,
      `double-opt-in`, `gdpr`, `vietnamese`, `agpl`.
- [ ] Social preview image: 1280×640, the dashboard screenshot plus the
      tagline "Own your list." (GitHub → Settings → General).
- [ ] Tag the release: `git tag -a v0.2.0-alpha.1 -m "0.2.0-alpha.1" && git push --tags`.
- [ ] Release notes must repeat the honest limits: alpha, no inbox guarantee,
      Docker-verified but not security-audited.

## 1. Donations

Do this before announcing; a repo with no way to give is a missed wave.

- [ ] GitHub Sponsors (needs a verified bank/tax profile; takes days — start now).
- [ ] `.github/FUNDING.yml` with the handle, plus a one-line "Sponsor" section in
      the README. Alternatives that work from Vietnam: Ko-fi, Buy Me a Coffee,
      Polar, Open Collective (needs a fiscal host).
- [ ] Say what money buys: a domain for a public demo, a hosted test inbox,
      translation review, and time. Do not promise features for donations.

Reality check: donations run at roughly 0.1–1% of active users. Ten thousand
stars is not ten thousand dollars. Traffic and a real use case come first.

## 2. Show HN

Title (pick one, keep it literal):

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
- Hard bounces and complaints suppress themselves from raw DSN/ARF reports.
- No tracking pixels, no link rewriting.

Ten interface languages; Vietnamese is the source language, English and the rest
are community-grade translations (corrections welcome).

It is an alpha: 36 tests, Docker verified on Windows and Linux, but no security
audit, no bounce IMAP poller, no visual template editor. AGPL-3.0.

Happy to answer anything about the queueing model — the interesting part is that
the audience is snapshotted at queue time and each send is claimed atomically, so
a crash leaves an `unknown` row for a human instead of a duplicate email.
```

Rules for the day: answer every comment for the first six hours, ship one small
fix visibly, and never argue about the licence.

## 3. r/selfhosted

Title: `Nếp Mail: self-hosted email campaigns (Docker + SQLite, double opt-in, no tracking)`

Body: lead with the stack and the screenshot, list limits honestly, link the
compose file. Mention AGPL. Do not cross-post the same text to five subreddits
in an hour.

## 4. awesome-selfhosted

Their list requires: a licence, a README, and no "alpha" that cannot run. Entry
for the _Communication - Email - Mailing Lists and Newsletters_ section:

```markdown
- [Nếp Mail](https://github.com/<owner>/nep-mail) - Email campaign tool with
  consent provenance, double opt-in signup forms, SPF/DKIM/DMARC checks and
  bounce suppression; runs on SQLite with your own SMTP relay. (`AGPL-3.0`)
```

Read `CONTRIBUTING.md` of that repository first; one entry per PR, alphabetical
order, no marketing adjectives.

## 5. Vietnamese communities

- Facebook groups for WordPress/Magento shop owners: the hook is "không trả phí
  gửi, dữ liệu khách hàng nằm trên máy mình, có bằng chứng đồng ý" (Nghị định 13).
- Dev communities (Viblo, Vietnam DevOps, r/vietnam): the hook is the
  architecture — SQLite + conditional claims + a single binary-ish deploy.
- Write one real tutorial ("Tự gửi bản tin 5.000 người với Postfix + DKIM trong
  30 phút") instead of ten announcements.

## 6. After launch

- Turn the first five bug reports into a 0.2.1 within a week; momentum is
  perishable.
- Publish the public roadmap as issues, not prose.
- Keep a `CHANGELOG.md` from the first release; contributors read it.
- If a hosting provider offers a free tier for open source, take the demo — a
  live instance converts better than any screenshot.
