import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext } from './tenancy.js';

/**
 * Projections are rebuildable. Every table carries `source_version` so a late-arriving stale
 * write is a no-op instead of an overwrite — out-of-order delivery stops mattering without a
 * locking scheme or a reordering buffer.
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    amountReceivedMinor: bigint('amount_received_minor', { mode: 'bigint' }).notNull().default(0n),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    applicationFeeAmountMinor: bigint('application_fee_amount_minor', { mode: 'bigint' }),
    onBehalfOf: text('on_behalf_of'),
    transferDestination: text('transfer_destination'),
    customerEmail: citext('customer_email'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pi_tenant_id').on(t.tenantId, t.stripePaymentIntentId)],
);

export const charges = pgTable(
  'charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    stripeChargeId: text('stripe_charge_id').notNull(),
    paymentIntentId: text('payment_intent_id'),
    balanceTransactionId: text('balance_transaction_id'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    amountRefundedMinor: bigint('amount_refunded_minor', { mode: 'bigint' }).notNull().default(0n),
    amountCapturedMinor: bigint('amount_captured_minor', { mode: 'bigint' }).notNull().default(0n),
    status: text('status').notNull(),
    paid: boolean('paid').notNull().default(false),
    refunded: boolean('refunded').notNull().default(false),
    disputed: boolean('disputed').notNull().default(false),
    captured: boolean('captured').notNull().default(false),
    onBehalfOf: text('on_behalf_of'),
    transferDestination: text('transfer_destination'),
    transferDataAmountMinor: bigint('transfer_data_amount_minor', { mode: 'bigint' }),
    transferId: text('transfer_id'),
    applicationFeeId: text('application_fee_id'),
    sourceTransferId: text('source_transfer_id'),
    chargeType: text('charge_type'),
    chargeTypeConfidence: numeric('charge_type_confidence'),
    chargeTypeSignals: jsonb('charge_type_signals'),
    paymentMethodBrand: text('payment_method_brand'),
    paymentMethodLast4: text('payment_method_last4'),
    customerEmail: citext('customer_email'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('charges_tenant_id').on(t.tenantId, t.stripeChargeId),
    index('charges_account_time').on(t.tenantId, t.stripeAccountId, t.stripeCreatedAt),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    stripeRefundId: text('stripe_refund_id').notNull(),
    chargeId: text('charge_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    balanceTransactionId: text('balance_transaction_id'),
    transferReversalId: text('transfer_reversal_id'),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('refunds_tenant_id').on(t.tenantId, t.stripeRefundId)],
);

export const transfers = pgTable(
  'transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeTransferId: text('stripe_transfer_id').notNull(),
    destinationAccountId: text('destination_account_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    amountReversedMinor: bigint('amount_reversed_minor', { mode: 'bigint' }).notNull().default(0n),
    currency: text('currency').notNull(),
    sourceTransaction: text('source_transaction'),
    balanceTransactionId: text('balance_transaction_id'),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('transfers_tenant_id').on(t.tenantId, t.stripeTransferId)],
);

export const transferReversals = pgTable(
  'transfer_reversals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeReversalId: text('stripe_reversal_id').notNull(),
    transferId: text('transfer_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
  },
  (t) => [uniqueIndex('reversals_tenant_id').on(t.tenantId, t.stripeReversalId)],
);

export const applicationFees = pgTable(
  'application_fees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeFeeId: text('stripe_fee_id').notNull(),
    chargeId: text('charge_id').notNull(),
    originatingAccountId: text('originating_account_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    amountRefundedMinor: bigint('amount_refunded_minor', { mode: 'bigint' }).notNull().default(0n),
    currency: text('currency').notNull(),
    refunded: boolean('refunded').notNull().default(false),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
  },
  (t) => [uniqueIndex('fees_tenant_id').on(t.tenantId, t.stripeFeeId)],
);

export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    stripeDisputeId: text('stripe_dispute_id').notNull(),
    chargeId: text('charge_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    evidenceDueBy: timestamp('evidence_due_by', { withTimezone: true }),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
  },
  (t) => [uniqueIndex('disputes_tenant_id').on(t.tenantId, t.stripeDisputeId)],
);

export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    stripePayoutId: text('stripe_payout_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    arrivalDate: date('arrival_date'),
    balanceTransactionId: text('balance_transaction_id'),
    automatic: boolean('automatic').notNull().default(true),
    stripeCreatedAt: timestamp('stripe_created_at', { withTimezone: true }).notNull(),
    sourceVersion: bigint('source_version', { mode: 'bigint' }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payouts_tenant_id').on(t.tenantId, t.stripePayoutId)],
);
