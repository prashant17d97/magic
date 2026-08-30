-- MAGIC 0007 — partition maintenance.
--
-- Partitions are created ahead of time by a scheduled job. Retention is DETACH + archive + DROP,
-- never DELETE: a bulk delete on a hot table fights autovacuum and bloats the heap for weeks.

CREATE OR REPLACE FUNCTION ensure_month_partition(parent TEXT, month_start DATE)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  child TEXT := format('%s_%s', parent, to_char(month_start, 'YYYY_MM'));
  next_month DATE := (month_start + INTERVAL '1 month')::date;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = child) THEN
    RETURN child;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    child, parent, month_start, next_month
  );
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO magic_app', child);
  RETURN child;
END
$$;

CREATE OR REPLACE FUNCTION ensure_year_partition(parent TEXT, year_start DATE)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  child TEXT := format('%s_%s', parent, to_char(year_start, 'YYYY'));
  next_year DATE := (year_start + INTERVAL '1 year')::date;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = child) THEN
    RETURN child;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    child, parent, year_start, next_year
  );
  EXECUTE format('GRANT SELECT, INSERT ON %I TO magic_app', child);
  RETURN child;
END
$$;

/*
 * Creates the current month plus `months_ahead` for the high-volume tables and the current
 * year for the audit log. Called at boot and on a schedule, so a partition gap can never
 * cause a webhook insert to fail.
 */
CREATE OR REPLACE FUNCTION ensure_partitions(months_ahead INTEGER DEFAULT 3)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  i INTEGER;
  month_start DATE;
BEGIN
  FOR i IN -1..months_ahead LOOP
    month_start := (date_trunc('month', now()) + (i || ' month')::interval)::date;
    PERFORM ensure_month_partition('stripe_events', month_start);
    PERFORM ensure_month_partition('balance_transactions', month_start);
  END LOOP;

  PERFORM ensure_year_partition('audit_log', date_trunc('year', now())::date);
  PERFORM ensure_year_partition('audit_log', (date_trunc('year', now()) + INTERVAL '1 year')::date);
END
$$;

SELECT ensure_partitions(3);
