-- MAGIC 0002 — the immutable raw layer and the transactional outbox.
-- stripe_events is partitioned from day one. Retrofitting partitioning onto a 500M-row
-- table is a migration nobody enjoys, and the whole point of the raw layer is that it grows.

CREATE TABLE stripe_events
(
    id                UUID        NOT NULL DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    connection_id     UUID        NOT NULL,
    stripe_event_id   TEXT        NOT NULL,
    stripe_account_id TEXT,
    event_type        TEXT        NOT NULL,
    api_version       TEXT,
    object_id         TEXT,
    object_type       TEXT,
    payload           JSONB       NOT NULL,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    stripe_created_at TIMESTAMPTZ NOT NULL,
    processed_at      TIMESTAMPTZ,
    process_status    TEXT        NOT NULL DEFAULT 'pending'
        CHECK (process_status IN ('pending', 'processed', 'failed', 'dead')),
    attempt_count     SMALLINT    NOT NULL DEFAULT 0,
    last_error        TEXT,
    trace_id          TEXT,
    PRIMARY KEY (id, stripe_created_at)
) PARTITION BY RANGE (stripe_created_at);

CREATE UNIQUE INDEX stripe_events_dedupe
    ON stripe_events (tenant_id, stripe_event_id, stripe_created_at);
CREATE INDEX stripe_events_unprocessed
    ON stripe_events (tenant_id, process_status, stripe_created_at) WHERE process_status IN ('pending','failed');
CREATE INDEX stripe_events_object
    ON stripe_events (tenant_id, object_id, stripe_created_at);

-- A default partition guarantees an insert never fails because a month was not pre-created.
-- The maintenance job moves rows out of it; a webhook must never be rejected for a DDL gap.
CREATE TABLE stripe_events_default PARTITION OF stripe_events DEFAULT;

CREATE TABLE outbox_jobs
(
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id    UUID        NOT NULL,
    queue        TEXT        NOT NULL,
    job_key      TEXT        NOT NULL,
    payload      JSONB       NOT NULL,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at   TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    attempts     SMALLINT    NOT NULL DEFAULT 0,
    last_error   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (queue, job_key)
);
CREATE INDEX outbox_pending ON outbox_jobs (available_at) WHERE published_at IS NULL;

CREATE TABLE dead_letter_jobs
(
    id             UUID PRIMARY KEY     DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    original_queue TEXT        NOT NULL,
    job_key        TEXT        NOT NULL,
    payload        JSONB       NOT NULL,
    error_message  TEXT        NOT NULL,
    error_stack    TEXT,
    attempts       SMALLINT    NOT NULL DEFAULT 0,
    failed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    replayed_at    TIMESTAMPTZ,
    replayed_by    UUID REFERENCES users (id)
);
CREATE INDEX dlq_open ON dead_letter_jobs (tenant_id, failed_at DESC) WHERE replayed_at IS NULL;
