import { sql } from 'drizzle-orm';
import { bigint, bigserial, index, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The raw layer. `stripe_events` is range-partitioned on `stripe_created_at`; Drizzle describes
 * the row shape for querying while the partitioning itself lives in the SQL migration, which is
 * the only place it can be expressed honestly.
 */
export const stripeEvents = pgTable(
  'stripe_events',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    stripeEventId: text('stripe_event_id').notNull(),
    stripeAccountId: text('stripe_account_id'),
    eventType: text('event_type').notNull(),
    apiVersion: text('api_version'),
    objectId: text('object_id'),
    objectType: text('object_type'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processStatus: text('process_status').notNull().default('pending'),
    attemptCount: smallint('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    traceId: text('trace_id'),
  },
  (t) => [index('stripe_events_lookup').on(t.tenantId, t.stripeEventId)],
);

export const outboxJobs = pgTable(
  'outbox_jobs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    queue: text('queue').notNull(),
    jobKey: text('job_key').notNull(),
    payload: jsonb('payload').notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: smallint('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('outbox_tenant_queue_key').on(t.tenantId, t.queue, t.jobKey)],
);

export const deadLetterJobs = pgTable('dead_letter_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  originalQueue: text('original_queue').notNull(),
  jobKey: text('job_key').notNull(),
  payload: jsonb('payload').notNull(),
  errorMessage: text('error_message').notNull(),
  errorStack: text('error_stack'),
  attempts: smallint('attempts').notNull().default(0),
  failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
  replayedAt: timestamp('replayed_at', { withTimezone: true }),
  replayedBy: uuid('replayed_by'),
});

export const balanceTransactions = pgTable(
  'balance_transactions',
  {
    id: uuid('id').notNull().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    stripeBtxnId: text('stripe_btxn_id').notNull(),
    type: text('type').notNull(),
    sourceId: text('source_id'),
    grossMinor: bigint('gross_minor', { mode: 'bigint' }).notNull(),
    feeMinor: bigint('fee_minor', { mode: 'bigint' }).notNull(),
    netMinor: bigint('net_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    payoutId: text('payout_id'),
    availableOn: timestamp('available_on', { withTimezone: true }),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
  },
  (t) => [index('btxn_lookup').on(t.tenantId, t.stripeBtxnId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).notNull(),
    tenantId: uuid('tenant_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorType: text('actor_type').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [index('audit_log_lookup').on(t.tenantId, t.createdAt)],
);
