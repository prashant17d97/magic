import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './tenancy.js';

export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    chargeId: text('charge_id').notNull(),
    chargeType: text('charge_type').notNull(),
    fundsHolderAccountId: text('funds_holder_account_id').notNull(),
    merchantAccountId: text('merchant_account_id').notNull(),
    currency: text('currency').notNull(),
    customerGrossMinor: bigint('customer_gross_minor', { mode: 'bigint' }).notNull(),
    processingFeeMinor: bigint('processing_fee_minor', { mode: 'bigint' }).notNull(),
    platformRevenueMinor: bigint('platform_revenue_minor', { mode: 'bigint' }).notNull(),
    merchantNetMinor: bigint('merchant_net_minor', { mode: 'bigint' }).notNull(),
    refundedMinor: bigint('refunded_minor', { mode: 'bigint' }).notNull().default(0n),
    reversedToPlatformMinor: bigint('reversed_to_platform_minor', { mode: 'bigint' }).notNull().default(0n),
    settlementStatus: text('settlement_status').notNull(),
    payoutId: text('payout_id'),
    feeBearer: text('fee_bearer'),
    chargedAt: timestamp('charged_at', { withTimezone: true }).notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    computedFromVersion: bigint('computed_from_version', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    uniqueIndex('settlements_tenant_charge').on(t.tenantId, t.chargeId),
    index('settlements_merchant').on(t.tenantId, t.merchantAccountId, t.chargedAt),
  ],
);

export const orderSourceConnections = pgTable('order_source_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  adapter: text('adapter').notNull(),
  displayName: text('display_name').notNull(),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  credentialsRef: text('credentials_ref'),
  status: text('status').notNull().default('active'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    sourceConnectionId: uuid('source_connection_id').notNull(),
    externalOrderId: text('external_order_id').notNull(),
    merchantAccountId: text('merchant_account_id'),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    expectedPlatformFeeMinor: bigint('expected_platform_fee_minor', { mode: 'bigint' }),
    status: text('status').notNull(),
    fulfillmentStatus: text('fulfillment_status'),
    customerEmail: citext('customer_email'),
    paymentIntentId: text('payment_intent_id'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    raw: jsonb('raw').notNull().default(sql`'{}'::jsonb`),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('orders_tenant_external').on(t.tenantId, t.sourceConnectionId, t.externalOrderId)],
);

export const orderLines = pgTable('order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  orderId: uuid('order_id').notNull(),
  sku: text('sku'),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull().default(1),
  unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
});

export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  orderId: uuid('order_id').notNull(),
  carrier: text('carrier'),
  trackingNumber: text('tracking_number'),
  status: text('status').notNull(),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
});

export const ruleVersions = pgTable('rule_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: integer('version').notNull().unique(),
  definition: jsonb('definition').notNull(),
  checksum: text('checksum').notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
  releasedBy: uuid('released_by'),
  notes: text('notes'),
});

export const tenantRuleSettings = pgTable(
  'tenant_rule_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    ruleId: text('rule_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    severityOverride: text('severity_override'),
    maturitySeconds: integer('maturity_seconds'),
    parameters: jsonb('parameters').notNull().default(sql`'{}'::jsonb`),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('rule_settings_tenant_rule').on(t.tenantId, t.ruleId)],
);

export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    scopeType: text('scope_type').notNull(),
    payoutId: text('payout_id'),
    windowStart: timestamp('window_start', { withTimezone: true }),
    windowEnd: timestamp('window_end', { withTimezone: true }),
    ruleVersion: integer('rule_version').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    snapshotChecksum: text('snapshot_checksum'),
    objectsEvaluated: integer('objects_evaluated').notNull().default(0),
    exceptionsOpened: integer('exceptions_opened').notNull().default(0),
    exceptionsClosed: integer('exceptions_closed').notNull().default(0),
    checksumDeltaMinor: bigint('checksum_delta_minor', { mode: 'bigint' }),
    payoutAmountMinor: bigint('payout_amount_minor', { mode: 'bigint' }),
    reconstructedMinor: bigint('reconstructed_minor', { mode: 'bigint' }),
    currency: text('currency'),
    triggeredBy: text('triggered_by').notNull(),
    triggeredByUser: uuid('triggered_by_user'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('runs_tenant_time').on(t.tenantId, t.createdAt)],
);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    settlementId: uuid('settlement_id').notNull(),
    orderId: uuid('order_id'),
    tier: text('tier').notNull(),
    confidence: numeric('confidence').notNull(),
    method: text('method').notNull(),
    candidates: jsonb('candidates'),
    runId: uuid('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('matches_tenant_settlement').on(t.tenantId, t.settlementId)],
);

export const exceptions = pgTable(
  'exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    ruleId: text('rule_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    layer: smallint('layer').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    scopeKey: text('scope_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    severity: text('severity').notNull(),
    status: text('status').notNull().default('open'),
    exposureMinor: bigint('exposure_minor', { mode: 'bigint' }),
    currency: text('currency'),
    expected: jsonb('expected').notNull(),
    actual: jsonb('actual').notNull(),
    evidence: jsonb('evidence').notNull(),
    ruleTrace: jsonb('rule_trace').notNull().default(sql`'{}'::jsonb`),
    narrative: text('narrative').notNull(),
    assignedTo: uuid('assigned_to'),
    firstSeenRunId: uuid('first_seen_run_id'),
    lastSeenRunId: uuid('last_seen_run_id'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by'),
    resolutionNote: text('resolution_note'),
  },
  (t) => [
    uniqueIndex('exceptions_tenant_fingerprint').on(t.tenantId, t.fingerprint),
    index('exceptions_queue').on(t.tenantId, t.status, t.severity, t.lastSeenAt),
  ],
);

export const exceptionEvents = pgTable('exception_events', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  exceptionId: uuid('exception_id').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  actorUserId: uuid('actor_user_id'),
  actorType: text('actor_type').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const syncCursors = pgTable(
  'sync_cursors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    cursorType: text('cursor_type').notNull(),
    lastObjectId: text('last_object_id'),
    lastCreatedAt: timestamp('last_created_at', { withTimezone: true }),
    backfillComplete: boolean('backfill_complete').notNull().default(false),
    backfillFloor: timestamp('backfill_floor', { withTimezone: true }),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cursors_tenant_account_type').on(t.tenantId, t.stripeAccountId, t.cursorType)],
);

export const completenessChecks = pgTable(
  'completeness_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    objectType: text('object_type').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    remoteCount: integer('remote_count').notNull(),
    localCount: integer('local_count').notNull(),
    drift: integer('drift'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('completeness_unique').on(t.tenantId, t.stripeAccountId, t.objectType, t.windowStart)],
);

export const exports = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  kind: text('kind').notNull(),
  format: text('format').notNull(),
  filters: jsonb('filters').notNull(),
  scopeSnapshot: text('scope_snapshot').array(),
  status: text('status').notNull().default('queued'),
  rowCount: integer('row_count'),
  objectKey: text('object_key'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    name: text('name').notNull(),
    resource: text('resource').notNull(),
    query: jsonb('query').notNull(),
    shared: boolean('shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('saved_views_unique').on(t.tenantId, t.ownerUserId, t.resource, t.name)],
);
