# Nếp Mail alpha — verification report

Date: 22 October 2026 (Asia/Ho_Chi_Minh). This report separates source, runtime and external delivery evidence.

| Gate                               | Evidence                                                                                                          | Status                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| BA                                 | `docs/01-BA.md`, acceptance and deferred gates                                                                    | Recorded                       |
| Design                             | Six modules, tokens, responsive tables, dialogs and email preview                                                 | Implemented                    |
| TypeScript                         | `tsc --noEmit`                                                                                                    | PASS                           |
| Self-host frontend                 | Vite production build                                                                                             | PASS                           |
| Automated tests                    | 36 Node tests: core, auth, HTTP, SQLite backup, loopback SMTP, localisation, signup, DNS/DKIM, bounces            | PASS                           |
| SMTP local                         | Nodemailer submitted real multipart MIME over a loopback SMTP fixture; unsubscribe headers inspected              | PASS                           |
| HTTP auth and persistence          | Real Node HTTP login/session, forged identity rejected, workspace/contact writes and static app                   | PASS                           |
| Browser UI                         | Isolated synthetic-identity fixture; desktop dashboard/editor/preflight and responsive frames 375/768/1024/1440   | Checked                        |
| Localisation                       | 10 locale packs, 284 keys each; coverage/placeholder test; live switcher, `<html lang>`, Intl dates and numbers   | PASS                           |
| Email language                     | Per-campaign `locale` column + migration; preview, SMTP handoff and opt-out page verified in en, ja and de        | PASS                           |
| Windows static assets              | Path guard compared `/` against `\\`; assets served `index.html` with `text/html`. Fixed and covered by HTTP test | PASS after fix                 |
| Double opt-in signup               | Public form, honeypot, rate limit, signed 48h link, GET non-mutating, POST activates, replay + suppression guards | PASS                           |
| DNS / DKIM                         | SPF, DKIM, DMARC and MX verdicts from injected DNS answers; RSA-2048 key and TXT record generation                | PASS                           |
| Bounce ingestion                   | RFC 3464 DSN and RFC 5965 ARF parsing; hard/complaint suppress, soft never does; API key required                 | PASS                           |
| Docker Compose                     | Real `docker compose up --build` on the authoring machine; app, SQLite volume and Mailpit healthy                 | PASS                           |
| Responsive overflow                | Root scroll width equals client width in all four frames after fixing hidden table label positioning              | PASS for overview              |
| Browser production sign-in         | Operator login over HTTP, session reused in a headless browser; dashboard, settings and editor read in en/vi/fr   | PASS for layout and strings    |
| SQLite recovery                    | Online backup restored a committed row and passed `integrity_check`                                               | PASS at unit/integration scope |
| Windows PowerShell                 | Launcher provided; no Windows executor available                                                                  | NOT RUN                        |
| Docker / Mailpit / Postfix         | Compose definitions and Postfix configuration supplied; Docker executable absent in authoring environment         | NOT RUN                        |
| Internet SMTP / Gmail / Outlook    | No owned mail domain, DKIM/private IP infrastructure or live recipient was configured                             | NOT RUN                        |
| HR / Business deployed integration | Receiver contract and replay/revocation tests only; other deployments untouched                                   | NOT CONNECTED                  |
| Public GitHub CI                   | Workflow supplied; no new GitHub repository created by this run                                                   | NOT RUN                        |
| Public source / commercial release | License decision, audit and operational release gates remain                                                      | NOT RELEASED                   |

## Automated invariants covered

1. Session signatures/tampering and password comparison.
2. Anonymous rejection, CSRF origin checks and forged identity headers.
3. Workspace isolation and viewer/editor/admin restrictions.
4. CSV quoting/BOM, consent provenance and all-or-nothing validation.
5. Import deduplication preserves unsubscribe and block state.
6. HTML escaping and subject header safety.
7. Preflight eligibility, immutable campaign contents and concurrent queue deduplication.
8. Conditional delivery claim avoids concurrent duplicate submission.
9. Recheck suppression at handoff and block synthetic recipient addresses.
10. Future schedules and cancellation; ambiguous SMTP outcomes not retried.
11. Live send default gate; signed opt-out GET does not mutate and POST unsubscribes.
12. Hashed/scoped integration keys, event replay, revocation and unsubscribe tombstones before upsert.
13. SQL injection payloads remain plain data.
14. SQLite backup integrity and local SMTP MIME structure.
15. Every locale ships the complete key set; no empty values and no dropped
    `{placeholders}` (fails the build on regression).
16. Locale resolution: exact key → `|one` plural → English → Vietnamese source.
17. Email chrome and `<html lang>` follow the campaign locale, not the viewer's.
18. Campaign `locale` is validated, persisted, used for preview and carried in
    the unsubscribe link (`&l=`).
19. Public unsubscribe page language comes from the link, then
    `Accept-Language`, and never leaks Vietnamese chrome into another language.
20. Signup stays `pending` until a signed link is confirmed; the confirmation
    GET never mutates, the POST is single-use, and replays are reported.
21. Suppressed and unsubscribed addresses cannot be resurrected through a public
    form, and the response never reveals whether the address exists.
22. Honeypot submissions and over-limit clients are answered without sending mail.
23. Integration keys can suppress addresses but cannot grant consent, change
    members or send a campaign.
24. DKIM private keys are returned once and never persisted; DNS checks reject
    malformed domain and selector input.

## Localisation caveat

The ten locale packs are AI-assisted first-pass translations produced inside the
repository workflow, then validated mechanically (key coverage, non-empty
values, placeholder parity). They have **not** been reviewed by native speakers,
and marketing copy may read stiffly. Treat them as a solid baseline, not a
certified translation. Corrections are welcome as pull requests — one file per
language, see `docs/I18N.md`.

The production dependency audit reported zero known advisories for the locked production packages on 22 October 2026. This does not audit development tooling, container images or application logic. The portable source installs independently; the lockfile pins PostCSS 8.5.23 to respect the configured seven-day package age policy.

No real contacts, credentials from other projects, or Internet email deliveries were used. A successful build or SMTP acceptance must not be described as delivery to inbox or production release.
