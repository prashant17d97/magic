-- MAGIC 0004 — the settlement boundary and the order-source contract.
-- Everything above settlements reads these columns and never learns that charge types exist.

CREATE TABLE settlements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_id                TEXT NOT NULL,
  charge_type              TEXT NOT NULL,

  funds_holder_account_id  TEXT NOT NULL,
  merchant_account_id      TEXT NOT NULL,

  currency                 CHAR(3) NOT NULL,
  customer_gross_minor     BIGINT NOT NULL,
  processing_fee_minor     BIGINT NOT NULL,
  platform_revenue_minor   BIGINT NOT NULL,
  merchant_net_minor       BIGINT NOT NULL,
  refunded_minor           BIGINT NOT NULL DEFAULT 0,
  reversed_to_platform_minor BIGINT NOT NULL DEFAULT 0,

  settlement_status        TEXT NOT NULL CHECK (settlement_status IN
                             ('pending','settled','partially_refunded','refunded','disputed','reversed')),
  payout_id                TEXT,
  fee_bearer               TEXT CHECK (fee_bearer IN ('platform','merchant')),

  charged_at               TIMESTAMPTZ NOT NULL,
  settled_at               TIMESTAMPTZ,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_from_version    BIGINT NOT NULL,

  UNIQUE (tenant_id, charge_id),
  CHECK (customer_gross_minor >= 0),
  CHECK (refunded_minor <= customer_gross_minor)
);

CREATE INDEX settlements_merchant_time ON settlements (tenant_id, merchant_account_id, charged_at DESC);
CREATE INDEX settlements_payout ON settlements (tenant_id, payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX settlements_status ON settlements (tenant_id, settlement_status, charged_at DESC);
CREATE INDEX settlements_unsettled ON settlements (tenant_id, charged_at) WHERE settlement_status = 'pending';
CREATE INDEX settlements_cursor ON settlements (tenant_id, charged_at DESC, id DESC);

CREATE TABLE order_source_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  adapter        TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  credentials_ref TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  last_synced_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_connection_id UUID NOT NULL REFERENCES order_source_connections(id) ON DELETE CASCADE,
  external_order_id    TEXT NOT NULL,
  merchant_account_id  TEXT,

  total_minor          BIGINT NOT NULL,
  currency             CHAR(3) NOT NULL,
  expected_platform_fee_minor BIGINT,

  status               TEXT NOT NULL,
  fulfillment_status   TEXT,
  customer_email       CITEXT,
  payment_intent_id    TEXT,

  placed_at            TIMESTAMPTZ NOT NULL,
  fulfilled_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  raw                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, source_connection_id, external_order_id)
);
CREATE INDEX orders_pi ON orders (tenant_id, payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX orders_match ON orders (tenant_id, currency, total_minor, placed_at);
CREATE INDEX orders_email ON orders (tenant_id, customer_email, placed_at);
CREATE INDEX orders_unpaid ON orders (tenant_id, placed_at) WHERE status = 'created';

CREATE TABLE order_lines (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku          TEXT,
  description  TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  unit_price_minor BIGINT NOT NULL,
  currency     CHAR(3) NOT NULL
);
CREATE INDEX order_lines_order ON order_lines (tenant_id, order_id);

CREATE TABLE shipments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier       TEXT,
  tracking_number TEXT,
  status        TEXT NOT NULL,
  shipped_at    TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ
);
CREATE INDEX shipments_order ON shipments (tenant_id, order_id);
