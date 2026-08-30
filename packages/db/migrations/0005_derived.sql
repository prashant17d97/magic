-- MAGIC 0005 — the derived layer. Everything here is recomputable from the two layers below it.

CREATE TABLE rule_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version        INTEGER NOT NULL UNIQUE,
  definition     JSONB NOT NULL,
  checksum       TEXT NOT NULL,
  released_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by    UUID REFERENCES users(id),
  notes          TEXT
);

CREATE TABLE tenant_rule_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id        TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  severity_override TEXT CHECK (severity_override IN ('critical','high','medium','low')),
  maturity_seconds  INTEGER,
  parameters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by     UUID REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_id)
);

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
  status              TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','superseded')),
  snapshot_checksum   TEXT,
  objects_evaluated   INTEGER NOT NULL DEFAULT 0,
  exceptions_opened   INTEGER NOT NULL DEFAULT 0,
  exceptions_closed   INTEGER NOT NULL DEFAULT 0,
  checksum_delta_minor BIGINT,
  payout_amount_minor  BIGINT,
  reconstructed_minor  BIGINT,
  currency            CHAR(3),
  triggered_by        TEXT NOT NULL,
  triggered_by_user   UUID REFERENCES users(id),
  started_at          TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX runs_scope ON reconciliation_runs (tenant_id, stripe_account_id, created_at DESC);
CREATE INDEX runs_cursor ON reconciliation_runs (tenant_id, created_at DESC, id DESC);

-- One live run per payout. A second concurrent run over the same scope would race on the
-- exception diff and could resurrect a finding an operator just resolved.
CREATE UNIQUE INDEX runs_active_payout
  ON reconciliation_runs (tenant_id, payout_id)
  WHERE status IN ('queued','running');

CREATE TABLE matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_id   UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
  tier            TEXT NOT NULL CHECK (tier IN ('exact','strong','heuristic','unmatched')),
  confidence      NUMERIC(3,2) NOT NULL,
  method          TEXT NOT NULL,
  candidates      JSONB,
  run_id          UUID REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, settlement_id)
);
CREATE INDEX matches_order ON matches (tenant_id, order_id);
CREATE INDEX matches_weak ON matches (tenant_id, tier) WHERE tier IN ('heuristic','unmatched');

CREATE TABLE exceptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id  TEXT NOT NULL,

  rule_id            TEXT NOT NULL,
  rule_version       INTEGER NOT NULL,
  layer              SMALLINT NOT NULL CHECK (layer IN (1,2,3)),

  subject_type       TEXT NOT NULL,
  subject_id         TEXT NOT NULL,
  scope_key          TEXT NOT NULL,
  fingerprint        TEXT NOT NULL,

  severity           TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','investigating','resolved','ignored')),

  exposure_minor     BIGINT,
  currency           CHAR(3),

  expected           JSONB NOT NULL,
  actual             JSONB NOT NULL,
  evidence           JSONB NOT NULL,
  rule_trace         JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative          TEXT NOT NULL,

  assigned_to        UUID REFERENCES users(id) ON DELETE SET NULL,
  first_seen_run_id  UUID REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
  last_seen_run_id   UUID REFERENCES reconciliation_runs(id) ON DELETE SET NULL,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note    TEXT,

  UNIQUE (tenant_id, fingerprint)
);
CREATE INDEX exc_queue ON exceptions (tenant_id, status, severity, last_seen_at DESC);
CREATE INDEX exc_cursor ON exceptions (tenant_id, last_seen_at DESC, id DESC);
CREATE INDEX exc_account ON exceptions (tenant_id, stripe_account_id, status);
CREATE INDEX exc_assignee ON exceptions (tenant_id, assigned_to, status) WHERE assigned_to IS NOT NULL;
CREATE INDEX exc_subject ON exceptions (tenant_id, subject_type, subject_id);
CREATE INDEX exc_rule ON exceptions (tenant_id, rule_id, first_seen_at DESC);
CREATE INDEX exc_open_exposure ON exceptions (tenant_id, currency, exposure_minor)
  WHERE status IN ('open','investigating');

CREATE TABLE exception_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exception_id   UUID NOT NULL REFERENCES exceptions(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('user','system')),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exception_events_lookup ON exception_events (tenant_id, exception_id, created_at);

CREATE TABLE sync_cursors (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id  TEXT NOT NULL,
  cursor_type        TEXT NOT NULL,
  last_object_id     TEXT,
  last_created_at    TIMESTAMPTZ,
  backfill_complete  BOOLEAN NOT NULL DEFAULT false,
  backfill_floor     TIMESTAMPTZ,
  last_error         TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, stripe_account_id, cursor_type)
);

CREATE TABLE completeness_checks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
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
CREATE INDEX completeness_drift ON completeness_checks (tenant_id, checked_at DESC) WHERE drift <> 0;

CREATE TABLE exports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by   UUID NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL,
  format         TEXT NOT NULL CHECK (format IN ('csv','xlsx')),
  filters        JSONB NOT NULL,
  scope_snapshot TEXT[],
  status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','running','ready','failed','expired')),
  row_count      INTEGER,
  object_key     TEXT,
  error          TEXT,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exports_recent ON exports (tenant_id, created_at DESC);

CREATE TABLE saved_views (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  resource       TEXT NOT NULL CHECK (resource IN ('exceptions','settlements','runs')),
  query          JSONB NOT NULL,
  shared         BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, owner_user_id, resource, name)
);
CREATE INDEX saved_views_lookup ON saved_views (tenant_id, resource, shared);

CREATE TABLE audit_log (
  id             BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id      UUID NOT NULL,
  actor_user_id  UUID,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('user','system','api')),
  action         TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  resource_id    TEXT NOT NULL,
  before         JSONB,
  after          JSONB,
  ip_address     INET,
  user_agent     TEXT,
  request_id     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX audit_lookup ON audit_log (tenant_id, resource_type, resource_id, created_at DESC);
CREATE INDEX audit_actor ON audit_log (tenant_id, actor_user_id, created_at DESC);
CREATE INDEX audit_cursor ON audit_log (tenant_id, created_at DESC, id DESC);
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
