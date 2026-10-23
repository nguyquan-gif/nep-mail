export type Row = Record<string, any>;
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Row>(): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
export type Identity = { id: string; email: string; name: string };
export type Mail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribe: string;
  idempotencyKey: string;
};
export interface Transport {
  send(mail: Mail): Promise<{ id: string }>;
}
export type Config = {
  captureAvailable?: boolean;
  liveEnabled?: boolean;
  publicUnsubscribeOrigin?: string;
  unsubscribeSecret?: string;
  /** Shared secret for provider bounce webhooks (`/api/v1/webhooks/:provider`). */
  relayWebhookSecret?: string;
  sender?: string;
  transport?: Transport;
  runtime: "sites" | "selfhost" | "test";
};
export type Context = { db: Database; user: Identity | null; config: Config };
