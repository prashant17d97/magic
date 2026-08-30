import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** `citext` keeps email comparison case-insensitive in the database rather than in every query. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  mfaSecretRef: text('mfa_secret_ref'),
  status: text('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    accountScope: text('account_scope').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('memberships_tenant_user').on(t.tenantId, t.userId), index('memberships_user').on(t.userId)],
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey(),
  theme: text('theme').notNull().default('system'),
  density: text('density').notNull().default('default'),
  columns: jsonb('columns').notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stripeConnections = pgTable('stripe_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  stripeAccountId: text('stripe_account_id').notNull(),
  livemode: boolean('livemode').notNull(),
  webhookPathKey: text('webhook_path_key').notNull().unique(),
  webhookSecretRef: text('webhook_secret_ref').notNull(),
  webhookSecretPrevRef: text('webhook_secret_prev_ref'),
  secretOverlapUntil: timestamp('secret_overlap_until', { withTimezone: true }),
  apiKeyRef: text('api_key_ref').notNull(),
  secretRotatedAt: timestamp('secret_rotated_at', { withTimezone: true }),
  takeRateBps: integer('take_rate_bps').notNull().default(1000),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connectedAccounts = pgTable(
  'connected_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    stripeAccountId: text('stripe_account_id').notNull(),
    accountType: text('account_type'),
    displayName: text('display_name'),
    country: text('country'),
    defaultCurrency: text('default_currency'),
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    requirementsDisabledReason: text('requirements_disabled_reason'),
    rawAccount: jsonb('raw_account').notNull().default(sql`'{}'::jsonb`),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('connected_accounts_tenant_acct').on(t.tenantId, t.stripeAccountId)],
);
