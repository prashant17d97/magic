-- MAGIC 0009 — authentication lookup.
--
-- Sign-in has to read a user and their memberships before any tenant is known, which row-level
-- security correctly refuses: with no tenant bound, `tenant_id = current_tenant_id()` matches
-- nothing. The wrong fix is to relax the policy, because that would make every unbound query a
-- way to read every tenant's membership list.
--
-- Instead there is one SECURITY DEFINER function with one job. It is owned by the schema owner,
-- takes an email and nothing else, and returns only what the sign-in screen needs. Everything it
-- can reach is enumerated in its body, so its blast radius is readable in twenty lines.

CREATE OR REPLACE FUNCTION auth_lookup(p_email CITEXT)
RETURNS TABLE (
  user_id         UUID,
  email           CITEXT,
  display_name    TEXT,
  password_hash   TEXT,
  status          TEXT,
  tenant_id       UUID,
  tenant_slug     TEXT,
  tenant_name     TEXT,
  tenant_timezone TEXT,
  role            TEXT,
  account_scope   TEXT[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.email, u.display_name, u.password_hash, u.status,
         t.id, t.slug, t.display_name, t.timezone,
         m.role, m.account_scope
    FROM users u
    LEFT JOIN memberships m ON m.user_id = u.id
    LEFT JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
   WHERE u.email = p_email
   ORDER BY t.display_name NULLS LAST
$$;

REVOKE ALL ON FUNCTION auth_lookup(CITEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup(CITEXT) TO magic_app;

-- Resolves the workspaces a known user belongs to, for the tenant switcher. Takes a user id that
-- the caller can only have obtained from an established session.
CREATE OR REPLACE FUNCTION auth_memberships(p_user_id UUID)
RETURNS TABLE (
  user_id         UUID,
  email           CITEXT,
  display_name    TEXT,
  tenant_id       UUID,
  tenant_slug     TEXT,
  tenant_name     TEXT,
  tenant_timezone TEXT,
  role            TEXT,
  account_scope   TEXT[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.email, u.display_name,
         t.id, t.slug, t.display_name, t.timezone,
         m.role, m.account_scope
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    JOIN tenants t ON t.id = m.tenant_id AND t.status = 'active'
   WHERE u.id = p_user_id
   ORDER BY t.display_name
$$;

REVOKE ALL ON FUNCTION auth_memberships(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_memberships(UUID) TO magic_app;

-- Records a successful sign-in without granting the application a general write on users.
CREATE OR REPLACE FUNCTION auth_touch_login(p_user_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE users SET last_login_at = now() WHERE id = p_user_id
$$;

REVOKE ALL ON FUNCTION auth_touch_login(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_touch_login(UUID) TO magic_app;

-- With sign-in served by the functions above, the users table no longer needs to be readable
-- outside a tenant context. Closing that removes an unbound read of every user in the system.
DROP POLICY IF EXISTS user_visible_through_membership ON users;
CREATE POLICY user_visible_through_membership ON users
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.user_id = users.id AND m.tenant_id = current_tenant_id()
    )
  )
  WITH CHECK (true);
