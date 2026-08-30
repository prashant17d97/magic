-- MAGIC 0012 — a dedicated owner for the cross-tenant lookup functions.
--
-- Migrations 0009 to 0011 answer the operations that legitimately precede tenant resolution with
-- SECURITY DEFINER functions. That works only while the function's owner can actually read the
-- tables, and on managed Postgres it cannot: the database user is the table owner but is not a
-- superuser, and every table here carries FORCE ROW LEVEL SECURITY, which applies to the owner
-- too. A SECURITY DEFINER function owned by that role therefore returns nothing at all — no
-- error, just an empty result. Sign-in fails, every webhook answers 404, the outbox never drains
-- and the sweep scheduler finds no accounts. Locally this stays invisible because a development
-- superuser bypasses row-level security entirely.
--
-- The answer is a role that exists only to own those functions. `magic_definer` cannot log in, so
-- no connection string can ever authenticate as it, and it is reachable only by calling one of
-- the seven functions below. Each function stays as narrow as it was.
--
-- FORCE ROW LEVEL SECURITY remains on every table, and the schema owner keeps no way through:
-- membership is granted WITH INHERIT FALSE, so the owner may hand a function over without
-- acquiring the carve-out itself.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'magic_definer') THEN
    CREATE ROLE magic_definer NOLOGIN;
  END IF;
END
$$;

-- SET TRUE allows `ALTER FUNCTION ... OWNER TO`; INHERIT FALSE stops the owner from picking up
-- the policies below as a side effect of being able to do so.
DO $$
BEGIN
  EXECUTE format('GRANT magic_definer TO %I WITH INHERIT FALSE, SET TRUE', current_user);
END
$$;

-- Reassigning a function to a new owner requires that owner to hold CREATE on the schema. The
-- grant is withdrawn at the end of this migration: `magic_definer` needs to own functions, not to
-- be able to create new objects.
GRANT USAGE, CREATE ON SCHEMA public TO magic_definer;

GRANT SELECT ON tenants, memberships, stripe_connections, connected_accounts TO magic_definer;
GRANT SELECT, UPDATE ON users, outbox_jobs TO magic_definer;

-- One policy per table, matching what the functions that read it actually do. `auth_touch_login`
-- stamps a last-seen time on `users`, and the relay claims and publishes rows in `outbox_jobs`,
-- so those two are the only tables where the definer may write.
CREATE POLICY definer_reads ON tenants             FOR SELECT TO magic_definer USING (true);
CREATE POLICY definer_reads ON memberships         FOR SELECT TO magic_definer USING (true);
CREATE POLICY definer_reads ON stripe_connections  FOR SELECT TO magic_definer USING (true);
CREATE POLICY definer_reads ON connected_accounts  FOR SELECT TO magic_definer USING (true);

CREATE POLICY definer_reads  ON users FOR SELECT TO magic_definer USING (true);
CREATE POLICY definer_writes ON users FOR UPDATE TO magic_definer USING (true) WITH CHECK (true);

CREATE POLICY definer_reads  ON outbox_jobs FOR SELECT TO magic_definer USING (true);
CREATE POLICY definer_writes ON outbox_jobs FOR UPDATE TO magic_definer USING (true) WITH CHECK (true);

ALTER FUNCTION auth_lookup(CITEXT)                OWNER TO magic_definer;
ALTER FUNCTION auth_memberships(UUID)             OWNER TO magic_definer;
ALTER FUNCTION auth_touch_login(UUID)             OWNER TO magic_definer;
ALTER FUNCTION outbox_claim(TEXT[], INT)          OWNER TO magic_definer;
ALTER FUNCTION outbox_mark_published(BIGINT[])    OWNER TO magic_definer;
ALTER FUNCTION webhook_connection(TEXT)           OWNER TO magic_definer;
ALTER FUNCTION active_sweep_targets()             OWNER TO magic_definer;

REVOKE CREATE ON SCHEMA public FROM magic_definer;
