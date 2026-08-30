-- MAGIC 0003 — the projection layer. Rebuildable by definition: if any of this is wrong,
-- it is dropped and recomputed from stripe_events plus a canonical re-fetch.

CREATE TABLE payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  amount_received_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL,
  application_fee_amount_minor BIGINT,
  on_behalf_of TEXT,
  transfer_destination TEXT,
  customer_email CITEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_payment_intent_id)
);
CREATE INDEX payment_intents_acct ON payment_intents (tenant_id, stripe_account_id, stripe_created_at DESC);

CREATE TABLE charges (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id       TEXT NOT NULL,
  stripe_charge_id        TEXT NOT NULL,
  payment_intent_id       TEXT,
  balance_transaction_id  TEXT,

  amount_minor            BIGINT NOT NULL,
  currency                CHAR(3) NOT NULL,
  amount_refunded_minor   BIGINT NOT NULL DEFAULT 0,
  amount_captured_minor   BIGINT NOT NULL DEFAULT 0,

  status                  TEXT NOT NULL,
  paid                    BOOLEAN NOT NULL DEFAULT false,
  refunded                BOOLEAN NOT NULL DEFAULT false,
  disputed                BOOLEAN NOT NULL DEFAULT false,
  captured                BOOLEAN NOT NULL DEFAULT false,

  on_behalf_of            TEXT,
  transfer_destination    TEXT,
  transfer_data_amount_minor BIGINT,
  transfer_id             TEXT,
  application_fee_id      TEXT,
  source_transfer_id      TEXT,

  charge_type             TEXT CHECK (charge_type IN ('direct','destination','separate','unclassified')),
  charge_type_confidence  NUMERIC(3,2),
  charge_type_signals     JSONB,

  payment_method_brand    TEXT,
  payment_method_last4    CHAR(4),

  customer_email          CITEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,

  stripe_created_at       TIMESTAMPTZ NOT NULL,
  source_version          BIGINT NOT NULL,
  synced_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, stripe_charge_id)
);
CREATE INDEX charges_acct_created ON charges (tenant_id, stripe_account_id, stripe_created_at DESC);
CREATE INDEX charges_pi ON charges (tenant_id, payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX charges_btxn ON charges (tenant_id, balance_transaction_id);
CREATE INDEX charges_unclassified ON charges (tenant_id, stripe_created_at) WHERE charge_type = 'unclassified';
CREATE INDEX charges_meta_order ON charges ((metadata->>'order_id')) WHERE metadata ? 'order_id';

CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  stripe_refund_id TEXT NOT NULL,
  charge_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  balance_transaction_id TEXT,
  transfer_reversal_id TEXT,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_refund_id)
);
CREATE INDEX refunds_charge ON refunds (tenant_id, charge_id);

CREATE TABLE transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_transfer_id TEXT NOT NULL,
  destination_account_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  amount_reversed_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  source_transaction TEXT,
  balance_transaction_id TEXT,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_transfer_id)
);
CREATE INDEX transfers_dest ON transfers (tenant_id, destination_account_id, stripe_created_at DESC);
CREATE INDEX transfers_source ON transfers (tenant_id, source_transaction) WHERE source_transaction IS NOT NULL;

CREATE TABLE transfer_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_reversal_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_reversal_id)
);
CREATE INDEX transfer_reversals_transfer ON transfer_reversals (tenant_id, transfer_id);

CREATE TABLE application_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_fee_id TEXT NOT NULL,
  charge_id TEXT NOT NULL,
  originating_account_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  amount_refunded_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  refunded BOOLEAN NOT NULL DEFAULT false,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_fee_id)
);
CREATE INDEX application_fees_charge ON application_fees (tenant_id, charge_id);

CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  stripe_dispute_id TEXT NOT NULL,
  charge_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  evidence_due_by TIMESTAMPTZ,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_dispute_id)
);
CREATE INDEX disputes_charge ON disputes (tenant_id, charge_id);

CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  stripe_payout_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL,
  arrival_date DATE,
  balance_transaction_id TEXT,
  automatic BOOLEAN NOT NULL DEFAULT true,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_payout_id)
);
CREATE INDEX payouts_recon_candidates
  ON payouts (tenant_id, stripe_account_id, status, arrival_date DESC);

CREATE TABLE balance_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  stripe_account_id TEXT NOT NULL,
  stripe_btxn_id TEXT NOT NULL,
  type TEXT NOT NULL,
  source_id TEXT,
  gross_minor BIGINT NOT NULL,
  fee_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  payout_id TEXT,
  available_on TIMESTAMPTZ,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  PRIMARY KEY (id, stripe_created_at)
) PARTITION BY RANGE (stripe_created_at);

CREATE UNIQUE INDEX btxn_dedupe ON balance_transactions (tenant_id, stripe_btxn_id, stripe_created_at);
CREATE INDEX btxn_by_payout ON balance_transactions (tenant_id, payout_id, stripe_created_at);
CREATE INDEX btxn_by_source ON balance_transactions (tenant_id, source_id, stripe_created_at);
CREATE TABLE balance_transactions_default PARTITION OF balance_transactions DEFAULT;
