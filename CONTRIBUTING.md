# Contributing to Nếp Mail

Nếp Mail is licensed under AGPL-3.0-or-later. By opening a pull request you agree
that your contribution is licensed under the same terms. There is no CLA: keep
the diff focused, and say what user problem it solves.

Use Node 24.19+ and the pinned pnpm version. Keep product behavior in `src/core`; runtime-specific functionality belongs in adapters. Never introduce provider-specific calls into domain rules. Use prepared SQL, authorize each workspace operation, preserve unsubscribe tombstones and keep secrets out of source and logs.

Before a change: describe the user problem and acceptance criteria; design the flow; implement; run typecheck, tests and self-host build; record release risks. Schema changes require reviewed migrations and a restore plan. No network email in automated tests.

Pull requests should state behavior, validation and limits. Translations are
welcome: one file per language under `src/core/locales/`, see `docs/I18N.md`. Add tests for meaningful security/delivery/data invariants. Report vulnerabilities privately, not in public issues with exploitable details or real contact data.
