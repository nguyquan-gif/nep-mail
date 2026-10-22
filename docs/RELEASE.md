# Release gates

Workflow: BA → Design → Code → Test → Release. Progress is recorded with evidence, not assumed from code presence.

## Private alpha

- Product contract and design recorded.
- Shared core, persistent self-host runtime and UI implemented.
- Automated tests and self-host build must pass on the final source package.
- UI fixture QA must distinguish synthetic identity from real login tests.
- Source archive excludes environment files, keys, real databases and platform identity.
- Licensed AGPL-3.0-or-later with a matching NOTICE (done for 0.2.0-alpha.1).

## Before a public source release

- Review dependency licences and generate an SBOM for the release tag.
- Create a standalone repository, enable private security reporting, branch protection and CI.
- Scan history and archive for secrets, private URLs and real records.
- Confirm clean-clone install and Docker build on Windows/WSL2 and Linux; pin image digests.
- Verify current dependency advisories; enable dependency update policy.
- Publish supported versions, contribution/governance policy and tested deployment limits.

## Before Internet delivery / commercial rollout

- Verify outbound TCP 25, A/PTR, SPF, DKIM and DMARC alignment with owned test inboxes.
- Confirm unsubscribe GET/POST works without login from the Internet.
- Verify Postfix cannot relay for any client except the intended app network identity.
- Ingest bounces and complaints into suppression; operator monitoring and abuse workflow.
- Exercise backup restoration in an isolated environment with sending off.
- Review authentication, tenant isolation, quotas/rate limits, retention and export/deletion.
- End-to-end test cancellation, crash ambiguity and SMTP queue reconciliation.
- Independent security and accessibility review; capacity and recovery tests.
- Native multi-user identity and self-service SaaS billing/signup if selling a hosted service.

Source readiness, container runtime readiness and Internet delivery readiness are separate gates. Passing one does not mark the others PASS.
