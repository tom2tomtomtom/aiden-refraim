-- Stripe delivers at least once. The checkout.session.completed handler sets
-- exports_this_month = 0, so every redelivery of one paid checkout handed the
-- user a fresh month of exports. Stripe also retries any non-2xx, which means
-- a handler that half-succeeded and returned 500 reset the counter again on
-- the retry.
--
-- This is the ledger of which event ids have been applied. A row here is a
-- claim, not a receipt: the handler inserts before doing the work and deletes
-- the row again if the work throws, so a genuine failure stays retryable while
-- a duplicate delivery does not.

CREATE TABLE IF NOT EXISTS refraim.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Only ever read by the retention sweep below.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_claimed_at
  ON refraim.stripe_webhook_events (claimed_at);

ALTER TABLE refraim.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE refraim.stripe_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE refraim.stripe_webhook_events TO service_role;

/**
 * Drop claims older than the window in which Stripe can still redeliver.
 *
 * Stripe retries a failing endpoint for up to 3 days; 30 days is generous
 * cover for manual replays from the dashboard without letting the table grow
 * without bound.
 */
CREATE OR REPLACE FUNCTION refraim.prune_stripe_webhook_events(
  p_retain_days INTEGER DEFAULT 30
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_retain_days < 7 OR p_retain_days > 365 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_retention_window';
  END IF;

  DELETE FROM refraim.stripe_webhook_events
   WHERE claimed_at < pg_catalog.now()
       - pg_catalog.make_interval(days => p_retain_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION refraim.prune_stripe_webhook_events(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refraim.prune_stripe_webhook_events(INTEGER) TO service_role;

DO $privilege_check$
BEGIN
  IF pg_catalog.has_table_privilege('anon', 'refraim.stripe_webhook_events', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'refraim.stripe_webhook_events', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'refraim.stripe_webhook_events', 'INSERT')
  THEN
    RAISE EXCEPTION 'invalid stripe_webhook_events privileges';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'refraim.prune_stripe_webhook_events(integer)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'refraim.prune_stripe_webhook_events(integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'invalid prune_stripe_webhook_events privileges';
  END IF;
END;
$privilege_check$;
