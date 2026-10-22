# Nếp HR / Nếp Business integration contract

No source system database is accessed automatically. No deployment in either product has been changed. The receiver is implemented in this repository; an authenticated client in each source product must be configured separately.

Create a dedicated key in the desired workspace's Integrations screen. The token is shown once, stored as a SHA-256 digest, and scoped to contact events for that workspace. Keep it server-side. Rotate by creating a new key, changing the client, then revoking the old key.

```http
POST /api/v1/events
Authorization: Bearer nep_<workspace-key>
Content-Type: application/json

{
  "id": "hr-employee-42-updated-20261022-001",
  "type": "contact.upsert",
  "contact": {
    "email": "person@your-domain.vn",
    "name": "Nguyễn Minh Anh",
    "tags": "nhan-su"
  }
}
```

Allowed event types: `contact.upsert`, `contact.unsubscribe`. The email and name are required for both event types. Upsert updates name/tags but never sets marketing consent and never restores an unsubscribed/suppressed address. Unsubscribe is remembered even if it arrives before the contact exists. A subsequent upsert does not restore eligibility.

Idempotency key scope is `(workspace, API key, external event id)`. Return values: `{accepted:true, marketingConsentGranted:false}` or `{duplicate:true}`. Keep the same event ID for retries; use a new ID for a genuinely new event. Key rotation changes the deduplication namespace, so do not replay historical events through a newly rotated key without planning.

- Nếp HR keys add `nep_hr` to the contact tags.
- Nếp Business keys add `nep_business`.
- Segmentation uses an exact comma-separated tag match, not substring matching.
- Marketing consent must be recorded by an authorized editor with provenance. Purchase or employment alone does not grant newsletter consent.
- Self-host endpoint uses its bearer key, not the admin cookie. Browser cross-origin writes are rejected; integrate server-to-server.
- A private hosted preview has an extra access gate. The key does not bypass hosting authentication. Use the independent self-host deployment for actual integration testing.

Recommended source-side outbox: store the business change and outgoing event atomically; retry transient failures with bounded exponential backoff; stop retrying revoked/invalid keys; retain a dead-letter list for operator resolution. The alpha receiver has a 600 KB request bound. Network-level rate limits and source-side outboxes are deployment tasks, not implemented clients in HR/Business.
