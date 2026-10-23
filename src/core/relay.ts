/**
 * HTTP relay adapter.
 *
 * Self-hosting assumes a port-25-capable server. Most people do not have one, so
 * this adapter sends through a transactional provider's HTTP API instead — no
 * MTA, no port 25, no warm-up IP — and receives bounces/complaints by webhook
 * rather than from a mailbox.
 *
 * Providers are intentionally thin: one function to build the request, one to
 * read its response, one to map webhook events. Adding Mailjet/Resend means
 * adding entries to the registries below, not touching campaign code.
 */
import type { Mail, Transport } from "./types.ts";
import type { BounceEvent } from "./bounce.ts";

export type RelayProvider = "brevo";

export type RelayConfig = {
  provider: RelayProvider;
  apiKey: string;
  /** Verified sender at the provider; becomes the envelope and From address. */
  sender: { email: string; name?: string };
  /** Override for tests or a regional endpoint. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

export const RELAY_PROVIDERS: RelayProvider[] = ["brevo"];

export function isRelayProvider(value: unknown): value is RelayProvider {
  return RELAY_PROVIDERS.includes(value as RelayProvider);
}

type RelayRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

type RelayResponse = { id: string };

const builders: Record<
  RelayProvider,
  (config: RelayConfig, mail: Mail) => RelayRequest
> = {
  brevo: (config, mail) => ({
    url: config.endpoint || "https://api.brevo.com/v3/smtp/email",
    headers: {
      "api-key": config.apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: {
      sender: {
        email: config.sender.email,
        ...(config.sender.name ? { name: config.sender.name } : {}),
      },
      to: [{ email: mail.to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
      // Brevo accepts custom headers only; standard ones may be dropped by the
      // provider. The unsubscribe URL is also in the message body, so opt-out
      // never depends on this header surviving.
      headers: {
        "List-Unsubscribe": `<${mail.unsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        IdempotencyKey: mail.idempotencyKey,
      },
    },
  }),
};

const responders: Record<
  RelayProvider,
  (status: number, payload: unknown) => RelayResponse
> = {
  brevo: (status, payload) => {
    if (status >= 400) {
      const body = payload as { code?: string; message?: string };
      throw new RelayError(
        status,
        body?.message || body?.code || "relay rejected the message",
      );
    }
    const id =
      (payload as { messageId?: string; messageIds?: string[] })?.messageId ||
      (payload as { messageIds?: string[] })?.messageIds?.[0];
    // A 2xx without an identifier still means accepted; keep the row traceable.
    return { id: id || "relay-accepted" };
  },
};

export class RelayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    // Never include the API key or the full provider body (it can echo the key).
    super(`relay ${status}: ${String(message).slice(0, 200)}`);
    this.status = status;
    this.name = "RelayError";
  }
}

export function relayTransport(config: RelayConfig): Transport {
  const build = builders[config.provider];
  const read = responders[config.provider];
  const doFetch = config.fetchImpl || fetch;
  return {
    async send(mail: Mail) {
      const request = build(config, mail);
      const response = await doFetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const result = read(response.status, payload);
      if (!response.ok) throw new RelayError(response.status, "rejected");
      return result;
    },
  };
}

/**
 * Map a provider webhook payload to bounce events. Accepts a single event, an
 * array, or `{items: [...]}`. Events that are not bounces (delivered, opened,
 * unsubscribed…) are ignored: unsubscribes are handled by signed links, not by
 * trusting a third party's claim.
 */
export function relayEventsFromPayload(
  provider: RelayProvider,
  payload: unknown,
): BounceEvent[] {
  if (provider !== "brevo") return [];
  const raw = payload as Record<string, unknown> | undefined;
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(raw?.items)
      ? (raw!.items as unknown[])
      : raw
        ? [raw]
        : [];
  const events: BounceEvent[] = [];
  for (const item of list) {
    const event = item as Record<string, unknown>;
    const email =
      typeof event?.email === "string" ? event.email.toLowerCase().trim() : "";
    if (!email) continue;
    const raw = String(event.event || "");
    // Brevo sends camelCase ("hardBounce"); other providers use snake_case, so
    // compare on a stripped key rather than guessing one convention.
    const name = raw.toLowerCase().replace(/[^a-z]/g, "");
    let kind: BounceEvent["kind"] | null = null;
    if (
      [
        "hardbounce",
        "blocked",
        "invalid",
        "invalidemail",
        "invalidrecipient",
      ].includes(name)
    )
      kind = "hard";
    else if (
      ["softbounce", "deferred", "error", "deliveryerror"].includes(name)
    )
      kind = "soft";
    else if (["spam", "complaint", "markasspam"].includes(name))
      kind = "complaint";
    if (!kind) continue;
    events.push({
      email,
      kind,
      // Brevo reports a human reason, not the remote SMTP status code.
      diagnostic:
        typeof event.reason === "string" ? event.reason.slice(0, 300) : raw,
    });
  }
  return events;
}
