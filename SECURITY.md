# Security policy — private alpha

This release is not independently security-audited and is not intended for an open multi-tenant Internet service.

Report suspected vulnerabilities privately to the repository owner through an established private channel or GitHub private vulnerability reporting when enabled. Do not include secrets, live contact lists or exploit instructions in a public issue. No public security-response email is invented in this repository.

Trust boundaries: reverse proxy terminates HTTPS; self-host admin session is HMAC signed and HttpOnly/SameSite=Strict; core uses verified identity and workspace membership; API tokens can submit contact events only. The self-host server ignores identity headers supplied by clients. Do not expose an internal trusted-header adapter directly to the Internet.

Direct SMTP trusts only the app's internal fixed IP; no host port is published. Do not attach untrusted containers to that network. Keep generated `.env`, SQLite database/WAL, DKIM private key and Postfix queue out of source and release archives. Rotate session/signing keys deliberately: session rotation logs users out, unsubscribe key rotation invalidates old opt-out links and therefore needs a compatibility plan.

Known limitations: single native admin, in-memory per-process login throttling, no external vulnerability assessment, no bounce/complaint ingestion, no SMTP queue-to-inbox reconciliation, no untrusted signup, no tenant billing/quotas at scale. Do not enable live delivery until the release checklist is satisfied.
