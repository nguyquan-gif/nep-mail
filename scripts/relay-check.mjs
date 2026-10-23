#!/usr/bin/env node
/**
 * Send one real message through the HTTP relay, to prove the API key, the
 * verified sender and the request shape before a campaign depends on them.
 *
 *   node --env-file=.env.relay scripts/relay-check.mjs you@example.com
 *
 * This sends a real email: pass an address you control. Nothing is written to
 * the database and no campaign or contact is touched.
 */
import {
  relayTransport,
  RelayError,
  isRelayProvider,
} from "../src/core/relay.ts";

const to = (process.argv[2] || "").trim();
const provider = process.env.RELAY_PROVIDER || "brevo";
const apiKey = process.env.RELAY_API_KEY || "";
const from = process.env.MAIL_FROM || "";
const fromName = process.env.MAIL_FROM_NAME || "";
// Omit the header entirely when there is no real opt-out URL: a dead
// `List-Unsubscribe` (placeholder domain) is a deliverability penalty, not a
// harmless default.
const unsubscribe = process.env.PUBLIC_UNSUBSCRIBE_ORIGIN
  ? `${process.env.PUBLIC_UNSUBSCRIBE_ORIGIN.replace(/\/$/, "")}/api/unsubscribe?token=check`
  : "";

if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) {
  console.error(
    "usage: node --env-file=.env.relay scripts/relay-check.mjs you@example.com",
  );
  process.exit(2);
}
if (!isRelayProvider(provider)) {
  console.error(`RELAY_PROVIDER must be one of: brevo (got "${provider}")`);
  process.exit(2);
}
if (!apiKey) {
  console.error(
    "RELAY_API_KEY is empty — paste the xkeysib-… key into .env.relay",
  );
  process.exit(2);
}
if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(from)) {
  console.error("MAIL_FROM must be the sender verified at the provider");
  process.exit(2);
}

const started = Date.now();
const transport = relayTransport({
  provider,
  apiKey,
  sender: { email: from, name: fromName || undefined },
});

try {
  const result = await transport.send({
    to,
    subject: "Nếp Mail relay check",
    html: `<p>This message proves the relay path works.</p><p>Sender: ${from}<br>Provider: ${provider}</p>${
      unsubscribe
        ? `<p style="font-size:12px"><a href="${unsubscribe}">Unsubscribe</a></p>`
        : ""
    }`,
    text: `Nếp Mail relay check.\nSender: ${from}\nProvider: ${provider}${
      unsubscribe ? `\nUnsubscribe: ${unsubscribe}` : ""
    }`,
    unsubscribe,
    idempotencyKey: `relay-check-${Date.now()}`,
  });
  console.log(
    `accepted by ${provider}: id=${result.id} (${Date.now() - started}ms)`,
  );
  console.log(
    `check the inbox of ${to.replace(/^(.)[^@]*/, "$1***")} and the Brevo dashboard for delivery events.`,
  );
} catch (error) {
  if (error instanceof RelayError) {
    console.error(
      `relay rejected the message: status ${error.status} — ${error.message}`,
    );
    console.error(
      error.status === 401 || error.status === 403
        ? "Likely causes: key revoked or wrong environment, sender/domain not verified, or a restricted key."
        : "Check Senders & Domains, the recipient address and any account restrictions.",
    );
  } else {
    console.error(
      "send failed:",
      error instanceof Error ? error.message : error,
    );
  }
  process.exit(1);
}
