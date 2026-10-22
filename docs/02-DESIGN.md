# Design and architecture

Primary surface: Vietnamese operations dashboard. Warm paper canvas, ink typography, evergreen accent, restrained 8px corners; compact tables, persistent navigation and generous section separation. No marketing hero or fabricated analytics.

Navigation: overview, campaigns, contacts, templates, integrations, settings/audit. Mobile navigation becomes a horizontal strip. Forms use visible labels, native validation and server validation. Dialogs preserve inputs on failure, move focus on open and support Escape.

Core `src/core` has no Next, Sites, Node or Cloudflare imports. It consumes a small prepared-statement database contract, verified identity, environment configuration and optional transport. Runtime adapters live in `app/api` and `selfhost`. UI is shared between both deployments.

Storage: SQLite-compatible schema; Cloudflare D1 in hosted alpha and SQLite WAL on a durable self-host volume. Migration files are schema-only. Membership checks use verified identity email; all child lookups also constrain workspace. API keys store SHA-256 digests and narrow integration scope, never general UI/admin permission.

Queue lifecycle: draft → queued → completed; queued → cancelled. Delivery lifecycle: pending → submitting → accepted/failed/unknown/skipped. A conditional claim prevents two processors from submitting the same row. Ambiguous failures remain `unknown` for operator review and are not automatically resent. There is no claim of exactly-once external delivery. A cancelled or suppressed recipient is checked again before submission.

Rendering accepts plain text, not arbitrary HTML. Personalization only supports first_name, name and email. Every value is HTML escaped. Provider credentials are runtime-only; the client receives readiness flags only. Sites alpha is owner-private, so real sending remains disabled there until a public unsubscribe endpoint exists.

Queueing uses an operation token and compares the saved campaign fields inside the atomic database batch. Recipient inserts are conditional on that token. A concurrent content/tag edit invalidates the attempt instead of combining an older audience with newer content.

Localisation: `src/core/i18n.ts` is shared by the UI and the server, so both
speak the same dictionary. Keys are the Vietnamese source strings; resolution is
locale → `|one` plural variant → English → the key itself, which keeps an
untranslated screen readable instead of exposing identifiers. The interface
language is a browser preference (`localStorage`), detected from
`navigator.languages`, applied to `<html lang>` and to `Intl` dates/numbers, and
sent to the API as `Accept-Language` so validation errors and readiness reasons
arrive already translated. Email is different: language belongs to the campaign
(`campaigns.locale`), because the recipient's language is not the operator's.
The chosen locale reaches the public unsubscribe page through the signed link
(`&l=`), so opt-out works without an account and without a session. Locale packs
are data-only modules under `src/core/locales/`; a coverage test fails the build
when a key, value or `{placeholder}` is missing.
