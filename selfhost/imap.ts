/**
 * IMAP bounce poller.
 *
 * Bounce reports (DSN) and complaint reports (ARF) are delivered to a mailbox,
 * not to the application. This adapter reads that mailbox on an interval, feeds
 * the raw messages through the same parser the HTTP ingest endpoint uses, and
 * marks them seen so a restart does not replay them.
 *
 * The IMAP client is injected (`clientFactory`) so the poll loop is testable
 * without a mail server.
 */
import { ImapFlow } from "imapflow";
import { applyBounceEvents } from "../src/core/api.ts";
import { dedupe, parseBounce } from "../src/core/bounce.ts";
import type { Context } from "../src/core/types.ts";

export type ImapOptions = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
  intervalMs: number;
  batch: number;
  /** Restrict suppression to one workspace; default is the whole instance. */
  workspaceId?: string;
};

export function imapOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ImapOptions | null {
  if (!env.BOUNCE_IMAP_HOST || !env.BOUNCE_IMAP_USER || !env.BOUNCE_IMAP_PASS)
    return null;
  const port = Number(env.BOUNCE_IMAP_PORT || 993);
  const interval = Number(env.BOUNCE_IMAP_INTERVAL || 60);
  return {
    host: env.BOUNCE_IMAP_HOST,
    port: Number.isFinite(port) && port > 0 ? port : 993,
    secure: env.BOUNCE_IMAP_SECURE !== "false",
    user: env.BOUNCE_IMAP_USER,
    pass: env.BOUNCE_IMAP_PASS,
    mailbox: env.BOUNCE_IMAP_MAILBOX || "INBOX",
    intervalMs: Math.max(15, Number.isFinite(interval) ? interval : 60) * 1000,
    batch: 25,
    workspaceId: env.BOUNCE_WORKSPACE || undefined,
  };
}

type Fetched = {
  uid?: number;
  source?: Buffer | string;
};

export type ImapClient = {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(mailbox: string): Promise<{ release(): void }>;
  search(
    query: Record<string, unknown>,
    options?: { uid?: boolean },
  ): Promise<number[] | false>;
  fetch(
    range: string,
    query: Record<string, unknown>,
    options?: { uid?: boolean },
  ): AsyncIterable<Fetched>;
  messageFlagsAdd(
    range: string,
    flags: string[],
    options?: { uid?: boolean },
  ): Promise<boolean>;
};

export type PollResult = {
  messages: number;
  events: number;
  suppressed: number;
  skipped?: boolean;
  error?: string;
};

const defaultFactory = (options: ImapOptions): ImapClient =>
  new ImapFlow({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.user, pass: options.pass },
    logger: false,
    // A bounce mailbox is low-volume; do not hold a connection for long.
    socketTimeout: 60_000,
  }) as unknown as ImapClient;

export function createBouncePoller(input: {
  options: ImapOptions;
  context: Context;
  clientFactory?: (options: ImapOptions) => ImapClient;
  log?: (line: string, detail?: Record<string, unknown>) => void;
}) {
  const { options, context } = input;
  const factory = input.clientFactory || defaultFactory;
  const log = input.log || (() => {});
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  async function pollOnce(): Promise<PollResult> {
    if (running)
      return { messages: 0, events: 0, suppressed: 0, skipped: true };
    running = true;
    const client = factory(options);
    let lock: { release(): void } | null = null;
    try {
      await client.connect();
      lock = await client.getMailboxLock(options.mailbox);
      const unseen = await client.search({ seen: false }, { uid: true });
      const uids = (unseen || []).slice(-options.batch);
      if (!uids.length) return { messages: 0, events: 0, suppressed: 0 };

      const raw: string[] = [];
      for await (const message of client.fetch(
        uids.join(","),
        { source: true },
        { uid: true },
      )) {
        const text = message.source
          ? Buffer.from(message.source as Buffer).toString("utf8")
          : "";
        if (text) raw.push(text);
        // Mark seen even when parsing finds nothing: an unrelated message in the
        // bounce mailbox must not be re-read on every tick.
        if (message.uid)
          await client.messageFlagsAdd(String(message.uid), ["\\Seen"], {
            uid: true,
          });
      }

      const events = dedupe(raw.flatMap((message) => parseBounce(message)));
      const applied = events.length
        ? await applyBounceEvents(context, events, options.workspaceId, "imap")
        : { received: 0, suppressed: 0 };
      log("bounce_poll", {
        messages: raw.length,
        events: applied.received,
        suppressed: applied.suppressed,
      });
      return {
        messages: raw.length,
        events: applied.received,
        suppressed: applied.suppressed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      log("bounce_poll_failed", { error: message });
      return { messages: 0, events: 0, suppressed: 0, error: message };
    } finally {
      try {
        lock?.release();
        await client.logout();
      } catch {
        /* connection already gone */
      }
      running = false;
    }
  }

  function start() {
    if (timer) return;
    void pollOnce();
    timer = setInterval(() => void pollOnce(), options.intervalMs);
    timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { pollOnce, start, stop, options };
}
