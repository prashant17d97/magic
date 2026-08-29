# MAGIC — Data Architecture & Database Design

**PostgreSQL 17 · Version 1.0 · 2026-08-29**

---

## 1. Modelling Principles

1. **Three layers, strictly separated.** Raw (immutable) → Projections (rebuildable) → Derived (recomputable). If the derived layer is ever wrong, drop it and recompute. Design for that from day one.
2. **Money is `BIGINT` minor units plus a `CHAR(3)` currency.** Never `float`, never `numeric` without a currency companion, never a bare number. Currency travels with every amount.
3. **`tenant_id` on every tenant-scoped table, leading every composite index.** Not optional, not "except this small lookup table."
4. **RLS on every tenant-scoped table, with `FORCE`.** Application filtering is defence one; the database is defence two.
5. **Append-only where history matters.** Raw events, audit log, and exception transitions are never updated in place.
6. **Time-partition the high-volume tables from the start.** Retrofitting partitioning onto a 500M-row table is a migration nobody enjoys.

---

## 2. Entity Overview

```
tenants
  ├── users ── memberships (role, account_scope)
  ├── stripe_connections ─── connected_accounts
  │        │
  │        └── stripe_events (RAW, partitioned)
  │               └── outbox_jobs
  │
  ├── PROJECTIONS
  │     payment_intents · charges · refunds · disputes
  │     transfers · transfer_reversals · application_fees
  │     payouts · balance_transactions (partitioned)
  │     settlements  ◄── the normalisation boundary
  │
  ├── order_source_connections ── orders ── order_lines
  │                                  └── shipments
  │
  └── DERIVED
        rule_versions · reconciliation_runs
        matches · exceptions · exception_events
        sync_cursors · completeness_checks
        exports · audit_log
```

---

## 3. Schema — Platform & Tenancy

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ─────────────────────────────────────────────────────────────
-- Tenancy
-- ─────────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'UTC',   -- drives day-boundary reporting
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','disabled')),
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- users are global; membership binds them to tenants

CREATE TABLE memberships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('admin','member','viewer')),
  -- account_scope: NULL means "all accounts in this tenant".
  -- A non-null array restricts the member to those connected accounts.
  account_scope     UUID[],
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX ON memberships (user_id);
```

**Why `account_scope` exists in v1.** A marketplace ops person is often responsible for a subset of sellers. Modelling permission as `(role, scope)` costs one column now; retrofitting a scope dimension across every query later is a rewrite.

---

## 4. Schema — Stripe Connections

```sql
CREATE TABLE stripe_connections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id      TEXT NOT NULL,          -- acct_… the PLATFORM account
  livemode               BOOLEAN NOT NULL,
  -- opaque, unguessable path segment for this tenant's webhook URL
  webhook_path_key       TEXT NOT NULL UNIQUE,
  -- references into the secret manager; NEVER the secret itself
  webhook_secret_ref     TEXT NOT NULL,
  api_key_ref            TEXT NOT NULL,
  secret_rotated_at      TIMESTAMPTZ,
  status                 TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','paused','revoked')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_account_id, livemode)
);

-- A tenant may legitimately hold more than one platform account
-- (regional entities, live/test). The UNIQUE above allows it.

CREATE TABLE connected_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id         UUID NOT NULL REFERENCES stripe_connections(id) ON DELETE CASCADE,
  stripe_account_id     TEXT NOT NULL,           -- acct_… the CONNECTED account
  account_type          TEXT CHECK (account_type IN ('standard','express','custom')),
  display_name          TEXT,
  country               CHAR(2),
  default_currency      CHAR(3),
  charges_enabled       BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled       BOOLEAN NOT NULL DEFAULT false,
  requirements_disabled_reason TEXT,
  raw_account           JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_account_id)
);
CREATE INDEX ON connected_accounts (tenant_id, connection_id);
CREATE INDEX ON connected_accounts (tenant_id, payouts_enabled)
  WHERE payouts_enabled = false;   -- drives exception suppression
```

**`payouts_enabled` is load-bearing.** A restricted account has paused payouts. Without this column, every restricted account generates a stream of false "missing payout" exceptions and the queue loses credibility in week one.

---

## 5. Schema — Raw Layer (immutable)

```sql
CREATE TABLE stripe_events (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  connection_id         UUID NOT NULL,
  stripe_event_id       TEXT NOT NULL,           -- evt_…
  -- NULL = platform-level event; non-null = Connect event for that account
  stripe_account_id     TEXT,
  event_type            TEXT NOT NULL,           -- charge.succeeded, payout.paid, …
  api_version           TEXT,
  object_id             TEXT,                    -- extracted for debounce/lookup
  object_type           TEXT,
  payload               JSONB NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_created_at     TIMESTAMPTZ NOT NULL,
  processed_at          TIMESTAMPTZ,
  process_status        TEXT NOT NULL DEFAULT 'pending'
                          CHECK (process_status IN ('pending','processed','failed','dead')),
  attempt_count         SMALLINT NOT NULL DEFAULT 0,
  last_error            TEXT,
  PRIMARY KEY (id, stripe_created_at)
) PARTITION BY RANGE (stripe_created_at);

-- Idempotency: the same event delivered twice is a no-op.
CREATE UNIQUE INDEX stripe_events_dedupe
  ON stripe_events (tenant_id, stripe_event_id, stripe_created_at);

CREATE INDEX stripe_events_unprocessed
  ON stripe_events (tenant_id, process_status, stripe_created_at)
  WHERE process_status IN ('pending','failed');

CREATE INDEX stripe_events_object
  ON stripe_events (tenant_id, object_id, stripe_created_at);

-- Monthly partitions, created ahead by a scheduled job (pg_partman or equivalent)
CREATE TABLE stripe_events_2026_09 PARTITION OF stripe_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
```

### Transactional outbox

```sql
CREATE TABLE outbox_jobs (
  id             BIGGENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  queue          TEXT NOT NULL,
  job_key        TEXT NOT NULL,          -- becomes BullMQ jobId → idempotent
  payload        JSONB NOT NULL,
  available_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at     TIMESTAMPTZ,
  published_at   TIMESTAMPTZ,
  attempts       SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (queue, job_key)
);
CREATE INDEX outbox_pending
  ON outbox_jobs (available_at)
  WHERE published_at IS NULL;
```

The relay polls `outbox_pending` every 200 ms, claims with `FOR UPDATE SKIP LOCKED`, publishes to BullMQ, marks published. At-least-once delivery; the consumer's `jobId` makes it effectively once.

---

## 6. Schema — Projection Layer

All projection tables share a common shape. `charges` shown in full; the rest follow the same pattern.

```sql
CREATE TABLE charges (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- which ledger this object lives on: platform acct or a connected acct
  stripe_account_id       TEXT NOT NULL,
  stripe_charge_id        TEXT NOT NULL,          -- ch_…
  payment_intent_id       TEXT,
  balance_transaction_id  TEXT,

  amount_minor            BIGINT NOT NULL,
  currency                CHAR(3) NOT NULL,
  amount_refunded_minor   BIGINT NOT NULL DEFAULT 0,
  amount_captured_minor   BIGINT NOT NULL DEFAULT 0,

  status                  TEXT NOT NULL,          -- succeeded|pending|failed
  paid                    BOOLEAN NOT NULL DEFAULT false,
  refunded                BOOLEAN NOT NULL DEFAULT false,
  disputed                BOOLEAN NOT NULL DEFAULT false,
  captured                BOOLEAN NOT NULL DEFAULT false,

  -- Connect shape signals — inputs to the classifier
  on_behalf_of            TEXT,
  transfer_destination    TEXT,
  transfer_data_amount_minor BIGINT,
  transfer_id             TEXT,
  application_fee_id      TEXT,
  source_transfer_id      TEXT,

  charge_type             TEXT CHECK (charge_type IN
                            ('direct','destination','separate','unclassified')),
  charge_type_confidence  NUMERIC(3,2),
  charge_type_signals     JSONB,

  -- non-sensitive card descriptors only. No PAN, ever.
  payment_method_brand    TEXT,
  payment_method_last4    CHAR(4),

  customer_email          CITEXT,
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,

  stripe_created_at       TIMESTAMPTZ NOT NULL,
  -- optimistic concurrency for out-of-order writes
  source_version          BIGINT NOT NULL,
  synced_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, stripe_charge_id)
);

CREATE INDEX charges_acct_created
  ON charges (tenant_id, stripe_account_id, stripe_created_at DESC);
CREATE INDEX charges_pi
  ON charges (tenant_id, payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE INDEX charges_btxn
  ON charges (tenant_id, balance_transaction_id);
CREATE INDEX charges_unclassified
  ON charges (tenant_id, stripe_created_at)
  WHERE charge_type = 'unclassified';
-- order matching by metadata key
CREATE INDEX charges_meta_order
  ON charges ((metadata->>'order_id'))
  WHERE metadata ? 'order_id';
```

**`source_version`** is the Stripe object's `created` (or a monotonic counter derived from the API response). Upserts use `WHERE excluded.source_version >= charges.source_version`, making late-arriving stale writes no-ops without a locking scheme.

### Remaining projections (abbreviated)

```sql
CREATE TABLE payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, stripe_account_id TEXT NOT NULL,
  stripe_payment_intent_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL, amount_received_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL, status TEXT NOT NULL,
  application_fee_amount_minor BIGINT,
  on_behalf_of TEXT, transfer_destination TEXT,
  customer_email CITEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  stripe_created_at TIMESTAMPTZ NOT NULL, source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_payment_intent_id)
);

CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, stripe_account_id TEXT NOT NULL,
  stripe_refund_id TEXT NOT NULL, charge_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL,
  status TEXT NOT NULL, reason TEXT,
  balance_transaction_id TEXT,
  transfer_reversal_id TEXT,          -- NULL here on a Connect refund is a red flag
  stripe_created_at TIMESTAMPTZ NOT NULL, source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_refund_id)
);

CREATE TABLE transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  stripe_transfer_id TEXT NOT NULL, destination_account_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL, amount_reversed_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  source_transaction TEXT,            -- NULL ⇒ aggregate reconciliation required
  balance_transaction_id TEXT,
  stripe_created_at TIMESTAMPTZ NOT NULL, source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_transfer_id)
);

CREATE TABLE transfer_reversals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  stripe_reversal_id TEXT NOT NULL, transfer_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL,
  stripe_created_at TIMESTAMPTZ NOT NULL, source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_reversal_id)
);

CREATE TABLE application_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  stripe_fee_id TEXT NOT NULL, charge_id TEXT NOT NULL,
  originating_account_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL, amount_refunded_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL, refunded BOOLEAN NOT NULL DEFAULT false,
  stripe_created_at TIMESTAMPTZ NOT NULL, source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_fee_id)
);

CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL, stripe_account_id TEXT NOT NULL,
  stripe_dispute_id TEXT NOT NULL, charge_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL,
  status TEXT NOT NULL, reason TEXT,
  evidence_due_by TIMESTAMPTZ,
  stripe_created_at TIMESTAMPTZ NOT NULL, source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_dispute_id)
);

CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  stripe_account_id TEXT NOT NULL,     -- whose balance paid out
  stripe_payout_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL,
  status TEXT NOT NULL,                -- paid|pending|in_transit|failed|canceled
  arrival_date DATE,
  balance_transaction_id TEXT,
  automatic BOOLEAN NOT NULL DEFAULT true,
  stripe_created_at TIMESTAMPTZ NOT NULL, source_version BIGINT NOT NULL,
  UNIQUE (tenant_id, stripe_payout_id)
);
CREATE INDEX payouts_recon_candidates
  ON payouts (tenant_id, stripe_account_id, status, arrival_date DESC);

-- High volume: partitioned
CREATE TABLE balance_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  stripe_account_id TEXT NOT NULL,
  stripe_btxn_id TEXT NOT NULL,
  type TEXT NOT NULL,                  -- charge|refund|transfer|payout|application_fee|…
  source_id TEXT,                      -- the object that produced it
  gross_minor BIGINT NOT NULL,
  fee_minor BIGINT NOT NULL,
  net_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  payout_id TEXT,                      -- set once assigned to a payout
  available_on TIMESTAMPTZ,
  stripe_created_at TIMESTAMPTZ NOT NULL,
  source_version BIGINT NOT NULL,
  PRIMARY KEY (id, stripe_created_at)
) PARTITION BY RANGE (stripe_created_at);

CREATE UNIQUE INDEX btxn_dedupe
  ON balance_transactions (tenant_id, stripe_btxn_id, stripe_created_at);
-- the payout checksum query
CREATE INDEX btxn_by_payout
  ON balance_transactions (tenant_id, payout_id, stripe_created_at);
```

---

## 7. The Settlement Boundary

This is the single most important table in the schema. Everything downstream reads it and never learns that charge types exist.

```sql
CREATE TABLE settlements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_id                TEXT NOT NULL,         -- ch_…
  charge_type              TEXT NOT NULL,

  -- which ledger holds the funds, and which account is the merchant
  funds_holder_account_id  TEXT NOT NULL,
  merchant_account_id      TEXT NOT NULL,

  currency                 CHAR(3) NOT NULL,
  customer_gross_minor     BIGINT NOT NULL,       -- what the customer paid
  processing_fee_minor     BIGINT NOT NULL,       -- Stripe's cut
  platform_revenue_minor   BIGINT NOT NULL,       -- application fee (net of refunds)
  merchant_net_minor       BIGINT NOT NULL,       -- what the merchant actually keeps
  refunded_minor           BIGINT NOT NULL DEFAULT 0,
  reversed_to_platform_minor BIGINT NOT NULL DEFAULT 0,

  settlement_status        TEXT NOT NULL CHECK (settlement_status IN
                             ('pending','settled','partially_refunded',
                              'refunded','disputed','reversed')),
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

CREATE INDEX settlements_merchant_time
  ON settlements (tenant_id, merchant_account_id, charged_at DESC);
CREATE INDEX settlements_payout
  ON settlements (tenant_id, payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX settlements_status
  ON settlements (tenant_id, settlement_status, charged_at DESC);
CREATE INDEX settlements_unsettled
  ON settlements (tenant_id, charged_at)
  WHERE settlement_status = 'pending';
```

The invariant the classifier and mappers must preserve, per charge:

```
customer_gross = processing_fee + platform_revenue + merchant_net + refunded
```

A violation is a bug in a mapper, not a finding about the client — it raises an internal alert, not a user-facing exception.

---

## 8. Schema — Orders (source-adapter contract)

```sql
CREATE TABLE order_source_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  adapter        TEXT NOT NULL,      -- 'mock' | 'shopify' | 'woocommerce' | 'csv'
  display_name   TEXT NOT NULL,
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- secrets by reference only
  credentials_ref TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  last_synced_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_connection_id UUID NOT NULL REFERENCES order_source_connections(id),
  external_order_id    TEXT NOT NULL,
  merchant_account_id  TEXT,                 -- which connected account fulfils it

  total_minor          BIGINT NOT NULL,
  currency             CHAR(3) NOT NULL,
  expected_platform_fee_minor BIGINT,        -- what the take rate implies

  status               TEXT NOT NULL,        -- created|paid|fulfilled|cancelled|refunded
  fulfillment_status   TEXT,                 -- unfulfilled|partial|fulfilled|returned
  customer_email       CITEXT,
  payment_intent_id    TEXT,                 -- strong match key when present

  placed_at            TIMESTAMPTZ NOT NULL,
  fulfilled_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  raw                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, source_connection_id, external_order_id)
);
CREATE INDEX orders_pi     ON orders (tenant_id, payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE INDEX orders_match  ON orders (tenant_id, currency, total_minor, placed_at);
CREATE INDEX orders_email  ON orders (tenant_id, customer_email, placed_at);
CREATE INDEX orders_unpaid ON orders (tenant_id, placed_at)
  WHERE status = 'created';

CREATE TABLE shipments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier       TEXT, tracking_number TEXT,
  status        TEXT NOT NULL,
  shipped_at    TIMESTAMPTZ, delivered_at TIMESTAMPTZ
);
CREATE INDEX ON shipments (tenant_id, order_id);
```

The mock adapter writes into exactly these tables. So will Shopify. That is the point — the adapter interface is defined by this schema, not by the first integration that happens to be built.

---

## 9. Schema — Derived Layer

```sql
-- ─────────── Rules ───────────
CREATE TABLE rule_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version        INTEGER NOT NULL UNIQUE,   -- global, monotonic
  definition     JSONB NOT NULL,            -- full rule set snapshot
  checksum       TEXT NOT NULL,             -- sha256 of definition
  released_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by    UUID REFERENCES users(id),
  notes          TEXT
);

CREATE TABLE tenant_rule_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id        TEXT NOT NULL,             -- e.g. 'L2.DEST.TRANSFER_MISSING'
  enabled        BOOLEAN NOT NULL DEFAULT true,
  severity_override TEXT CHECK (severity_override IN ('critical','high','medium','low')),
  maturity_seconds  INTEGER,                -- overrides the rule default
  parameters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_id)
);

-- ─────────── Runs ───────────
CREATE TABLE reconciliation_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id   TEXT NOT NULL,
  scope_type          TEXT NOT NULL CHECK (scope_type IN ('payout','window','platform')),
  payout_id           TEXT,
  window_start        TIMESTAMPTZ,
  window_end          TIMESTAMPTZ,
  rule_version        INTEGER NOT NULL REFERENCES rule_versions(version),
  mode                TEXT NOT NULL CHECK (mode IN ('transactional','aggregate')),
  status              TEXT NOT NULL CHECK (status IN
                        ('queued','running','completed','failed','superseded')),
  snapshot_checksum   TEXT,                 -- determinism proof
  objects_evaluated   INTEGER NOT NULL DEFAULT 0,
  exceptions_opened   INTEGER NOT NULL DEFAULT 0,
  exceptions_closed   INTEGER NOT NULL DEFAULT 0,
  checksum_delta_minor BIGINT,              -- payout checksum residual; 0 is healthy
  triggered_by        TEXT NOT NULL,        -- 'webhook'|'schedule'|'manual'
  triggered_by_user   UUID REFERENCES users(id),
  started_at          TIMESTAMPTZ, finished_at TIMESTAMPTZ,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX runs_scope
  ON reconciliation_runs (tenant_id, stripe_account_id, created_at DESC);
CREATE UNIQUE INDEX runs_active_payout
  ON reconciliation_runs (tenant_id, payout_id)
  WHERE status IN ('queued','running');    -- one live run per payout

-- ─────────── Matching ───────────
CREATE TABLE matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_id   UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  tier            TEXT NOT NULL CHECK (tier IN ('exact','strong','heuristic','unmatched')),
  confidence      NUMERIC(3,2) NOT NULL,
  method          TEXT NOT NULL,            -- 'metadata.order_id', 'amount+email+window', …
  candidates      JSONB,                    -- rejected candidates, for auditability
  run_id          UUID REFERENCES reconciliation_runs(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, settlement_id)
);
CREATE INDEX matches_order  ON matches (tenant_id, order_id);
CREATE INDEX matches_weak   ON matches (tenant_id, tier)
  WHERE tier IN ('heuristic','unmatched');

-- ─────────── Exceptions ───────────
CREATE TABLE exceptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id  TEXT NOT NULL,

  rule_id            TEXT NOT NULL,
  rule_version       INTEGER NOT NULL,
  layer              SMALLINT NOT NULL CHECK (layer IN (1,2,3)),

  -- stable identity: same finding across re-runs is the SAME row
  subject_type       TEXT NOT NULL,         -- charge|payout|transfer|order|account
  subject_id         TEXT NOT NULL,
  scope_key          TEXT NOT NULL,         -- payout id or window key
  fingerprint        TEXT NOT NULL,         -- sha256(rule_id|subject_id|scope_key)

  severity           TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','investigating','resolved','ignored')),

  -- exposure: what money is at stake
  exposure_minor     BIGINT,
  currency           CHAR(3),

  -- the explainability payload
  expected           JSONB NOT NULL,
  actual             JSONB NOT NULL,
  evidence           JSONB NOT NULL,        -- object ids, amounts, rule params used
  narrative          TEXT NOT NULL,         -- human-readable one-liner

  assigned_to        UUID REFERENCES users(id),
  first_seen_run_id  UUID REFERENCES reconciliation_runs(id),
  last_seen_run_id   UUID REFERENCES reconciliation_runs(id),
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID REFERENCES users(id),
  resolution_note    TEXT,

  UNIQUE (tenant_id, fingerprint)
);
CREATE INDEX exc_queue
  ON exceptions (tenant_id, status, severity, last_seen_at DESC);
CREATE INDEX exc_account
  ON exceptions (tenant_id, stripe_account_id, status);
CREATE INDEX exc_assignee
  ON exceptions (tenant_id, assigned_to, status)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX exc_subject
  ON exceptions (tenant_id, subject_type, subject_id);
CREATE INDEX exc_open_exposure
  ON exceptions (tenant_id, currency, exposure_minor)
  WHERE status IN ('open','investigating');

CREATE TABLE exception_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  exception_id   UUID NOT NULL REFERENCES exceptions(id) ON DELETE CASCADE,
  from_status    TEXT, to_status TEXT NOT NULL,
  actor_user_id  UUID REFERENCES users(id),
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('user','system')),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON exception_events (tenant_id, exception_id, created_at);
```

**`fingerprint` is what makes re-runs safe.** Re-running reconciliation does not create duplicate findings and does not resurrect a resolved exception — it updates `last_seen_*` on the existing row. An exception only reopens when the underlying facts change, which shows up as a changed `expected`/`actual` payload.

### Sync state and completeness

```sql
CREATE TABLE sync_cursors (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  stripe_account_id  TEXT NOT NULL,
  cursor_type        TEXT NOT NULL,   -- 'events'|'charges'|'payouts'|'transfers'
  last_object_id     TEXT,
  last_created_at    TIMESTAMPTZ,
  backfill_complete  BOOLEAN NOT NULL DEFAULT false,
  backfill_floor     TIMESTAMPTZ,     -- how far back we have swept
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_account_id, cursor_type)
);

CREATE TABLE completeness_checks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  stripe_account_id  TEXT NOT NULL,
  object_type        TEXT NOT NULL,
  window_start       TIMESTAMPTZ NOT NULL,
  window_end         TIMESTAMPTZ NOT NULL,
  remote_count       INTEGER NOT NULL,
  local_count        INTEGER NOT NULL,
  drift              INTEGER GENERATED ALWAYS AS (remote_count - local_count) STORED,
  checked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_account_id, object_type, window_start)
);
CREATE INDEX completeness_drift
  ON completeness_checks (tenant_id, checked_at DESC)
  WHERE drift <> 0;
```

### Exports and audit

```sql
CREATE TABLE exports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by   UUID NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL,     -- 'exceptions'|'settlements'|'runs'
  format         TEXT NOT NULL CHECK (format IN ('csv','xlsx')),
  filters        JSONB NOT NULL,
  scope_snapshot UUID[],            -- account scope AT GENERATION TIME
  status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','ready','failed','expired')),
  row_count      INTEGER,
  object_key     TEXT,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  actor_user_id  UUID,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('user','system','api')),
  action         TEXT NOT NULL,     -- 'exception.resolve', 'rule.update', …
  resource_type  TEXT NOT NULL,
  resource_id    TEXT NOT NULL,
  before         JSONB,
  after          JSONB,
  ip_address     INET,
  user_agent     TEXT,
  request_id     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_lookup ON audit_log (tenant_id, resource_type, resource_id, created_at DESC);
CREATE INDEX audit_actor  ON audit_log (tenant_id, actor_user_id, created_at DESC);

REVOKE UPDATE, DELETE ON audit_log FROM magic_app;   -- append-only, enforced by grant
```

---

## 10. Row-Level Security

```sql
-- Application connects as a NON-OWNER role. This matters:
-- table owners bypass RLS unless FORCE is set, and superusers always bypass it.
CREATE ROLE magic_app LOGIN;
GRANT USAGE ON SCHEMA public TO magic_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO magic_app;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Applied to every tenant-scoped table:
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements FORCE  ROW LEVEL SECURITY;   -- ← the line people forget

CREATE POLICY tenant_isolation ON settlements
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
```

### Binding the context

```sql
BEGIN;
  SET LOCAL app.tenant_id = '…';   -- LOCAL: dies with the transaction
  -- queries here are automatically scoped
COMMIT;
```

`SET LOCAL` rather than `SET` is non-negotiable under connection pooling. A session-level `SET` survives the connection's return to the pool and leaks the previous request's tenant into the next one — the exact bug RLS was adopted to prevent.

### Pitfalls this design closes

| Pitfall | Mitigation |
|---|---|
| Table owner bypasses RLS | `FORCE ROW LEVEL SECURITY` + non-owner app role |
| Session variable leaks across pooled connections | `SET LOCAL` inside an explicit transaction, enforced by a repository base class |
| `WITH CHECK` omitted → writes escape isolation | Every policy declares both `USING` and `WITH CHECK` |
| Unset GUC silently matches nothing (or errors) | `current_tenant_id()` returns NULL; policies fail closed |
| Policy expression not index-usable | `tenant_id` leads every composite index; policy is a simple equality |
| Sequential scan on large tables under RLS | Verified with `EXPLAIN` in CI on the ten hottest queries |

### The negative test

```
CI must contain a test that:
  1. seeds two tenants with overlapping data
  2. binds session to tenant A
  3. runs SELECT * FROM settlements  (deliberately unfiltered)
  4. asserts zero tenant-B rows returned
```

This test is the proof of NFR-10. Without it, isolation is a claim rather than a property.

---

## 11. Partitioning & Retention

| Table | Strategy | Retention (hot) | Cold path |
|---|---|---|---|
| `stripe_events` | RANGE monthly on `stripe_created_at` | 90 days | Parquet → object storage |
| `balance_transactions` | RANGE monthly on `stripe_created_at` | 13 months | Parquet → object storage |
| `audit_log` | RANGE yearly | 7 years | Never dropped |
| `settlements` | Unpartitioned in v1 | — | Partition if > 100M rows |
| `exceptions` | Unpartitioned | — | Working set is small by design |

Partitions are pre-created 3 months ahead by a scheduled job. Retention is a `DETACH PARTITION` + archive + `DROP`, not a `DELETE` — a bulk delete on a hot table fights autovacuum and bloats the heap.

---

## 12. Query Patterns to Protect

The five queries whose plans must be verified in CI:

```sql
-- 1. Exception queue (the primary screen). Cursor pagination — never OFFSET.
SELECT * FROM exceptions
WHERE tenant_id = $1
  AND status = ANY($2)
  AND (last_seen_at, id) < ($cursor_ts, $cursor_id)
ORDER BY last_seen_at DESC, id DESC
LIMIT 50;
-- serves from exc_queue

-- 2. Payout checksum
SELECT payout_id,
       SUM(net_minor) AS reconstructed_minor
FROM balance_transactions
WHERE tenant_id = $1 AND payout_id = $2
GROUP BY payout_id;
-- serves from btxn_by_payout, single partition when the payout is recent

-- 3. Open exposure by severity (health tile)
SELECT severity, currency, SUM(exposure_minor)
FROM exceptions
WHERE tenant_id = $1 AND status IN ('open','investigating')
GROUP BY severity, currency;
-- serves from exc_open_exposure

-- 4. Heuristic match candidates
SELECT * FROM orders
WHERE tenant_id = $1
  AND currency = $2
  AND total_minor BETWEEN $3 AND $4
  AND placed_at BETWEEN $5 AND $6
  AND status <> 'cancelled';
-- serves from orders_match

-- 5. Completeness drift
SELECT stripe_account_id, object_type, drift
FROM completeness_checks
WHERE tenant_id = $1 AND drift <> 0 AND checked_at > now() - interval '2 days';
-- serves from completeness_drift (partial index)
```

**Cursor pagination everywhere.** `OFFSET 200000` is a scan of 200,000 rows the user will never see. At T2 that is the difference between 40 ms and 8 seconds.

---

## 13. Migration Discipline

Expand → deploy → backfill → contract. Every schema change ships in at least two releases.

```
Release N   : ADD COLUMN nullable, no constraint. Old code ignores it.
Release N   : deploy code that writes both old and new.
Background  : backfill in batches (10k rows, throttled, resumable).
Release N+1 : ADD CONSTRAINT NOT VALID → VALIDATE CONSTRAINT (no long lock).
Release N+2 : DROP old column.
```

Never in a single release: add a NOT NULL column with a default on a large table, rewrite a table, or drop a column the previous image still reads.

---

## 14. Data Quality Gates

Checks run at every stage, not just the end.

| Stage | Check | Failure action |
|---|---|---|
| Ingest | Signature valid; `event_id` unique | Reject / no-op |
| Projection | `source_version` monotonic; currency ISO-4217 | Skip stale write; alert on invalid currency |
| Settlement | `gross = fee + platform + net + refunded` | **Internal alert** — this is our bug, not the client's |
| Settlement | `refunded ≤ gross` | DB `CHECK` constraint |
| Matching | ≤ 1 accepted match per settlement | DB `UNIQUE` constraint |
| Reconciliation | Snapshot checksum reproducible | Fail the run, do not commit exceptions |
| Daily | `completeness_drift = 0` | Page |
