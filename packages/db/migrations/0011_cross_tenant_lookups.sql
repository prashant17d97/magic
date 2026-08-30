-- MAGIC 0011 — the remaining cross-tenant lookups.
--
-- Two paths have to resolve a tenant before one is known, which is the same shape 0009 solved for
-- sign-in and 0010 for the outbox relay. Both ran through `withoutTenant`, which opens a plain
-- transaction and therefore changes nothing about row-level security: as `magic_app` with no
-- tenant bound they matched no rows at all. The webhook endpoint answered 404 to every valid
-- delivery, and the sweep scheduler found no accounts to sweep.
--
-- Each gets a SECURITY DEFINER function narrow enough to read in one screen.

-- Resolves the opaque webhook path key. Returns nothing but the connection the endpoint needs to
-- verify a signature, so a caller holding a key learns only about that key's own connection.
CREATE OR REPLACE FUNCTION webhook_connection(p_path_key TEXT)
RETURNS TABLE (
  id                       UUID,
  tenant_id                UUID,
  stripe_account_id        TEXT,
  webhook_secret_ref       TEXT,
  webhook_secret_prev_ref  TEXT,
  secret_overlap_until     TIMESTAMPTZ,
  status                   TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id, c.tenant_id, c.stripe_account_id, c.webhook_secret_ref,
         c.webhook_secret_prev_ref, c.secret_overlap_until, c.status
    FROM stripe_connections c
   WHERE c.webhook_path_key = p_path_key
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION webhook_connection(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION webhook_connection(TEXT) TO magic_app;

-- Enumerates the accounts the scheduler fans out over. Returns identifiers only: no balances, no
-- settlement figures, nothing a caller could use to learn about another tenant's money.
CREATE OR REPLACE FUNCTION active_sweep_targets()
RETURNS TABLE (tenant_id UUID, stripe_account_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT a.tenant_id, a.stripe_account_id
    FROM connected_accounts a
    JOIN tenants t ON t.id = a.tenant_id AND t.status = 'active'
   ORDER BY a.tenant_id, a.stripe_account_id
$$;

REVOKE ALL ON FUNCTION active_sweep_targets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION active_sweep_targets() TO magic_app;
