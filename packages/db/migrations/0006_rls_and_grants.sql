-- MAGIC 0006 — row-level security and least-privilege grants.
--
-- Three details carry the whole isolation guarantee, and each is the one people forget:
--   1. The application connects as a NON-OWNER role. A table owner bypasses RLS by default.
--   2. FORCE ROW LEVEL SECURITY, so even a policy-exempt path is closed.
--   3. Every policy declares USING *and* WITH CHECK. USING alone filters reads but still lets
--      a write land in another tenant's rows.

-- The password arrives as a transaction-local setting from the migrator, never as a literal here:
-- this file is in version control, and a role that can read every tenant's rows is not something
-- to hand out with the source. `ALTER` runs unconditionally so that rotating the value in the
-- environment and re-running actually rotates the password, rather than silently keeping the one
-- the role was first created with.
DO $$
DECLARE
  app_password TEXT := NULLIF(current_setting('magic.app_password', true), '');
BEGIN
  IF app_password IS NULL THEN
    RAISE EXCEPTION 'MAGIC_APP_PASSWORD must be set: the application role has no usable password without it.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'magic_app') THEN
    EXECUTE format('CREATE ROLE magic_app LOGIN PASSWORD %L', app_password);
  ELSE
    EXECUTE format('ALTER ROLE magic_app LOGIN PASSWORD %L', app_password);
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO magic_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO magic_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO magic_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO magic_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO magic_app;

-- Append-only tables, enforced by grant rather than by convention. A convention is a comment;
-- a revoked grant is a property.
REVOKE UPDATE, DELETE ON audit_log FROM magic_app;
REVOKE UPDATE, DELETE ON exception_events FROM magic_app;
REVOKE DELETE ON stripe_events FROM magic_app;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION current_tenant_id() TO magic_app;

-- Applies the same two-sided policy to every tenant-scoped table. Doing this in a loop rather
-- than by hand removes the possibility of one table quietly missing a policy.
DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'memberships','stripe_connections','connected_accounts','stripe_events','outbox_jobs',
    'dead_letter_jobs','payment_intents','charges','refunds','transfers','transfer_reversals',
    'application_fees','disputes','payouts','balance_transactions','settlements',
    'order_source_connections','orders','order_lines','shipments','tenant_rule_settings',
    'reconciliation_runs','matches','exceptions','exception_events','sync_cursors',
    'completeness_checks','exports','saved_views','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
      t
    );
  END LOOP;
END
$$;

-- tenants and users are not tenant-scoped rows, so they carry their own policies.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

-- A user row is visible when the bound tenant has a membership for it. This keeps assignee
-- lookups working without exposing the global user table across tenants.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE  ROW LEVEL SECURITY;
CREATE POLICY user_visible_through_membership ON users
  USING (
    current_tenant_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.tenant_id = current_tenant_id()
    )
  )
  WITH CHECK (true);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY preferences_self ON user_preferences USING (true) WITH CHECK (true);

-- rule_versions is a global catalogue: the same rule set governs every tenant, and a tenant's
-- deviation is expressed as parameters in tenant_rule_settings rather than as a private rule.
ALTER TABLE rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY rule_versions_readable ON rule_versions USING (true) WITH CHECK (true);
