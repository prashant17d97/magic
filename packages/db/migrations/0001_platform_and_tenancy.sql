-- MAGIC 0001 — extensions, tenancy, identity and Stripe connections.
-- Migrations are plain SQL on purpose: during an incident a DBA reads this file, not a generator.

CREATE
EXTENSION IF NOT EXISTS "pgcrypto";
CREATE
EXTENSION IF NOT EXISTS "btree_gin";
CREATE
EXTENSION IF NOT EXISTS "citext";

CREATE TABLE tenants
(
    id           UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    slug         TEXT        NOT NULL UNIQUE,
    display_name TEXT        NOT NULL,
    timezone     TEXT        NOT NULL DEFAULT 'UTC',
    status       TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'archived')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users
(
    id             UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    email          CITEXT      NOT NULL UNIQUE,
    display_name   TEXT        NOT NULL,
    password_hash  TEXT        NOT NULL,
    mfa_secret_ref TEXT,
    status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships
(
    id            UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role          TEXT        NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    account_scope TEXT[],
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE user_preferences
(
    user_id    UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    theme      TEXT        NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
    density    TEXT        NOT NULL DEFAULT 'default' CHECK (density IN ('compact', 'default', 'comfortable')),
    columns    JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stripe_connections
(
    id                      UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    stripe_account_id       TEXT        NOT NULL,
    livemode                BOOLEAN     NOT NULL,
    webhook_path_key        TEXT        NOT NULL UNIQUE,
    webhook_secret_ref      TEXT        NOT NULL,
    webhook_secret_prev_ref TEXT,
    secret_overlap_until    TIMESTAMPTZ,
    api_key_ref             TEXT        NOT NULL,
    secret_rotated_at       TIMESTAMPTZ,
    take_rate_bps           INTEGER     NOT NULL DEFAULT 1000,
    status                  TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'revoked')),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, stripe_account_id, livemode)
);

CREATE TABLE connected_accounts
(
    id                           UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    tenant_id                    UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    connection_id                UUID        NOT NULL REFERENCES stripe_connections (id) ON DELETE CASCADE,
    stripe_account_id            TEXT        NOT NULL,
    account_type                 TEXT CHECK (account_type IN ('standard', 'express', 'custom')),
    display_name                 TEXT,
    country                      CHAR(2),
    default_currency             CHAR(3),
    charges_enabled              BOOLEAN     NOT NULL DEFAULT false,
    payouts_enabled              BOOLEAN     NOT NULL DEFAULT false,
    requirements_disabled_reason TEXT,
    raw_account                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    synced_at                    TIMESTAMPTZ,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, stripe_account_id)
);
CREATE INDEX connected_accounts_conn ON connected_accounts (tenant_id, connection_id);

-- Drives exception suppression. Without it every restricted account produces a stream of
-- false "missing payout" findings and the queue loses credibility in its first week.
CREATE INDEX connected_accounts_payouts_paused
    ON connected_accounts (tenant_id, payouts_enabled) WHERE payouts_enabled = false;
