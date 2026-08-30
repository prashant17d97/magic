-- MAGIC 0008 — scope outbox idempotency to the tenant.
--
-- The original UNIQUE (queue, job_key) was global. Two tenants processing objects that happen to
-- share an identifier would then collide: the second tenant's job would be silently swallowed by
-- ON CONFLICT DO NOTHING and its event would never be processed. That is precisely the silent
-- hole the outbox exists to close, so the constraint has to carry tenant_id like every other
-- uniqueness rule in the schema.

ALTER TABLE outbox_jobs DROP CONSTRAINT IF EXISTS outbox_jobs_queue_job_key_key;
ALTER TABLE outbox_jobs ADD CONSTRAINT outbox_jobs_tenant_queue_job_key
  UNIQUE (tenant_id, queue, job_key);
