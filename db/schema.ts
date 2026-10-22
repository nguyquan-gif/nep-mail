import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});
export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    email: text("email").notNull(),
    role: text("role").notNull(),
  },
  (t) => [uniqueIndex("member_workspace_email").on(t.workspaceId, t.email)],
);
export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    tags: text("tags").notNull().default(""),
    status: text("status").notNull().default("active"),
    consent: integer("consent").notNull().default(0),
    consentSource: text("consent_source").notNull().default(""),
    consentAt: text("consent_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("contact_workspace_email").on(t.workspaceId, t.email),
    index("contact_workspace").on(t.workspaceId),
  ],
);
export const campaigns = sqliteTable(
  "campaigns",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    preheader: text("preheader").notNull().default(""),
    body: text("body").notNull(),
    category: text("category").notNull().default("marketing"),
    audienceTag: text("audience_tag").notNull().default(""),
    locale: text("locale").notNull().default("vi"),
    status: text("status").notNull().default("draft"),
    scheduledAt: text("scheduled_at"),
    queueToken: text("queue_token"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("campaign_workspace").on(t.workspaceId)],
);
export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("pending"),
    providerId: text("provider_id"),
    error: text("error"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("delivery_campaign_contact").on(t.campaignId, t.contactId),
    index("delivery_workspace_campaign").on(t.workspaceId, t.campaignId),
  ],
);
export const integrationKeys = sqliteTable(
  "integration_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    digest: text("digest").notNull(),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (t) => [uniqueIndex("integration_digest").on(t.digest)],
);
export const integrationEvents = sqliteTable(
  "integration_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    keyId: text("key_id")
      .notNull()
      .references(() => integrationKeys.id),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("event_workspace_key_id").on(
      t.workspaceId,
      t.keyId,
      t.externalId,
    ),
  ],
);
export const signupForms = sqliteTable(
  "signup_forms",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tag: text("tag").notNull().default(""),
    locale: text("locale").notNull().default("vi"),
    consentSource: text("consent_source").notNull(),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("signup_form_slug").on(t.slug)],
);
export const signupRequests = sqliteTable(
  "signup_requests",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    formId: text("form_id")
      .notNull()
      .references(() => signupForms.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    tokenDigest: text("token_digest").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [
    uniqueIndex("signup_request_token").on(t.tokenDigest),
    index("signup_request_form_email").on(t.formId, t.email),
  ],
);
export const audit = sqliteTable(
  "audit",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_workspace_created").on(t.workspaceId, t.createdAt)],
);
