-- MAGIC 0010 — outbox relay claim.
--
-- The relay drains every tenant's outbox from one process, which row-level security correctly
-- refuses: it runs as `magic_app` with no tenant bound, so `tenant_id = current_tenant_id()`
-- matches nothing and the queue never drains. Binding a tenant is not an option, because the
-- relay does not know which tenants have work, and relaxing the policy would turn every unbound
-- query into a cross-tenant read.
--
-- The same answer as 0009 applies: two SECURITY DEFINER functions with one job each. They take a
-- queue allow-list and return only outbox columns, so a caller cannot reach tenant data through
-- them, and the tenant id they return is the one the relay must stamp on the published job.

CREATE OR REPLACE FUNCTION outbox_claim(p_queues TEXT[], p_batch INT)
RETURNS TABLE (
  id        BIGINT,
  tenant_id UUID,
  queue     TEXT,
  job_key   TEXT,
  payload   JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE outbox_jobs
     SET claimed_at = now(), attempts = attempts + 1
   WHERE outbox_jobs.id IN (
     SELECT o.id FROM outbox_jobs o
      WHERE o.published_at IS NULL
        AND o.available_at <= now()
        AND o.queue = ANY(p_queues)
      ORDER BY o.id
      FOR UPDATE SKIP LOCKED
      LIMIT p_batch
   )
  RETURNING outbox_jobs.id, outbox_jobs.tenant_id, outbox_jobs.queue,
            outbox_jobs.job_key, outbox_jobs.payload
$$;

REVOKE ALL ON FUNCTION outbox_claim(TEXT[], INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_claim(TEXT[], INT) TO magic_app;

-- Closes the pass. Separate from the claim so an at-least-once republish stays possible: a relay
-- that dies between the two leaves the rows claimable rather than losing them.
CREATE OR REPLACE FUNCTION outbox_mark_published(p_ids BIGINT[])
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE outbox_jobs SET published_at = now() WHERE id = ANY(p_ids)
$$;

REVOKE ALL ON FUNCTION outbox_mark_published(BIGINT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION outbox_mark_published(BIGINT[]) TO magic_app;
