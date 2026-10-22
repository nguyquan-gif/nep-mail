/**
 * Bounce and complaint ingestion.
 *
 * Accepts raw RFC 3464 delivery-status notifications (DSN) and RFC 5965 abuse
 * reports (ARF), or an already-parsed `{email, kind}` payload from a provider
 * webhook. Hard failures and complaints must suppress the address: continuing
 * to send to them is what burns a domain's reputation.
 */
export type BounceKind = "hard" | "soft" | "complaint";
export type BounceEvent = {
  email: string;
  kind: BounceKind;
  status?: string;
  diagnostic?: string;
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function addressOf(value: string): string {
  const match = value.match(EMAIL);
  return match ? match[0].toLowerCase() : "";
}

/** Parse one or more bounce/complaint events out of a raw message. */
export function parseBounce(raw: string): BounceEvent[] {
  if (!raw || raw.length > 2_000_000) return [];
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  const events: BounceEvent[] = [];

  // ARF complaint report (feedback loop): the offending address is in the
  // original message headers, but most providers also fill in the body.
  const feedback = unfolded
    .match(/^Feedback-Type:\s*(\S+)/im)?.[1]
    ?.toLowerCase();
  if (feedback) {
    const reported =
      addressOf(unfolded.match(/^Original-Rcpt-To:\s*(.+)$/im)?.[1] || "") ||
      addressOf(unfolded.match(/^From:\s*(.+)$/im)?.[1] || "");
    if (reported)
      events.push({
        email: reported,
        kind: "complaint",
        diagnostic: `feedback-type: ${feedback}`,
      });
    if (events.length) return events;
  }

  // DSN: each recipient block starts with Final-Recipient. Parse forward from
  // each occurrence until the next block.
  const starts = [
    ...unfolded.matchAll(/Final-Recipient:\s*([^;]+);\s*([^\s]+)/gi),
  ];
  if (starts.length) {
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i].index ?? 0;
      const end = starts[i + 1]?.index ?? unfolded.length;
      const block = unfolded.slice(start, end);
      const email = addressOf(starts[i][2] || "");
      if (!email) continue;
      const status = block.match(
        /^Status:\s*([0-9]\.[0-9]{1,3}\.[0-9]{1,3})/im,
      )?.[1];
      const diagnostic =
        clean(block.match(/^Diagnostic-Code:\s*(.+)$/im)?.[1] || "") ||
        clean(block.match(/^Action:\s*(.+)$/im)?.[1] || "");
      const hard = status?.startsWith("5.") || /Action:\s*failed/i.test(block);
      events.push({
        email,
        kind: hard ? "hard" : "soft",
        status,
        diagnostic: diagnostic || undefined,
      });
    }
    if (events.length) return events;
  }

  // Plain-text fallbacks: "550 5.1.1 <user@example.com>: user unknown".
  for (const line of unfolded.split(/(?<=\.)\s+(?=\S)/)) {
    const email = addressOf(line);
    if (!email) continue;
    const status = line.match(/\b([45]\.[0-9]{1,3}\.[0-9]{1,3})\b/)?.[1];
    if (
      !status &&
      !/\b(unknown user|user unknown|does not exist|mailbox full)\b/i.test(line)
    )
      continue;
    events.push({
      email,
      kind: status?.startsWith("5.") ? "hard" : "soft",
      status,
      diagnostic: clean(line).slice(0, 300),
    });
  }
  return dedupe(events);
}

export function dedupe(events: BounceEvent[]): BounceEvent[] {
  const seen = new Map<string, BounceEvent>();
  for (const event of events) {
    const key = `${event.email}|${event.kind}`;
    if (!seen.has(key)) seen.set(key, event);
  }
  return [...seen.values()];
}

/** Validate a pre-parsed payload coming from a provider webhook. */
export function normalizeEvent(input: unknown): BounceEvent | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const email =
    typeof value.email === "string" ? value.email.toLowerCase().trim() : "";
  if (!EMAIL.test(email)) return null;
  const kindInput = String(value.kind || value.type || "hard").toLowerCase();
  const kind: BounceKind = kindInput.startsWith("comp")
    ? "complaint"
    : kindInput.startsWith("soft") || kindInput.startsWith("temp")
      ? "soft"
      : "hard";
  return {
    email,
    kind,
    status:
      typeof value.status === "string" ? value.status.slice(0, 20) : undefined,
    diagnostic:
      typeof value.diagnostic === "string"
        ? value.diagnostic.slice(0, 500)
        : undefined,
  };
}
