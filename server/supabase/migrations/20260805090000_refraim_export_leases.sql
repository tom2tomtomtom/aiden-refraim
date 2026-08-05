-- Give a running export a lease it must keep renewing, and a way to find the
-- exports whose lease has lapsed. Recovery already exists and is correct; it
-- was only ever reachable from a client poll, so a job whose browser tab
-- closed stayed non-terminal and its video stayed claimed forever.
--
-- The lease is the only new source of truth. Ownership fencing keeps using
-- processing_metadata.active_job_id and the job status transitions, which
-- already serialise two concurrent recoverers.

ALTER TABLE refraim.processing_jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- Jobs already in flight when this ships have no lease. The sweep falls back
-- to the previous updated_at heuristic for exactly those rows.
CREATE INDEX IF NOT EXISTS idx_processing_jobs_lease_expires_at
  ON refraim.processing_jobs (lease_expires_at)
  WHERE pg_catalog.lower(status) NOT IN (
    'completed', 'complete', 'failed', 'failed_compensated',
    'failed_allowance_refunded', 'error'
  );

/**
 * Extend a live render's lease. Returns FALSE when the job is gone or already
 * terminal, which tells the caller its run no longer owns anything and the
 * heartbeat should stop. Deliberately does not touch updated_at: that column
 * means "progress moved", and a heartbeat is not progress.
 */
CREATE OR REPLACE FUNCTION refraim.heartbeat_refraim_export(
  p_job_id UUID,
  p_user_id UUID,
  p_lease_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_held BOOLEAN := FALSE;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_export_lease';
  END IF;

  UPDATE refraim.processing_jobs
     SET lease_expires_at = pg_catalog.now()
       + pg_catalog.make_interval(secs => p_lease_seconds)
   WHERE id = p_job_id
     AND user_id = p_user_id
     AND pg_catalog.lower(status) NOT IN (
       'completed', 'complete', 'failed', 'failed_compensated',
       'failed_allowance_refunded', 'error'
     )
  RETURNING TRUE INTO v_held;

  RETURN COALESCE(v_held, FALSE);
END;
$$;

/**
 * List exports whose worker is provably gone, newest staleness last so the
 * longest-stuck user is served first.
 *
 * This only discovers candidates; it takes no ownership. Two replicas sweeping
 * the same row concurrently is already safe, because recovery serialises on
 * the conditional job-status transition and the video publication fence, and
 * the Gateway replay is idempotent on request id. A second ownership scheme
 * layered here would be able to mask staleness from the poll path, so there
 * isn't one.
 */
CREATE OR REPLACE FUNCTION refraim.list_stale_refraim_exports(
  p_limit INTEGER DEFAULT 25,
  p_legacy_stale_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE(job_id UUID, video_id UUID, user_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_sweep_limit';
  END IF;

  RETURN QUERY
  SELECT job.id, job.video_id, job.user_id
    FROM refraim.processing_jobs AS job
   WHERE pg_catalog.lower(job.status) NOT IN (
           'completed', 'complete', 'failed', 'failed_compensated',
           'failed_allowance_refunded', 'error'
         )
     AND (
       CASE
         WHEN job.lease_expires_at IS NOT NULL THEN job.lease_expires_at < v_now
         ELSE COALESCE(job.updated_at, job.created_at)
           < v_now - pg_catalog.make_interval(secs => p_legacy_stale_seconds)
       END
     )
   ORDER BY COALESCE(job.updated_at, job.created_at)
   LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION refraim.heartbeat_refraim_export(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refraim.list_stale_refraim_exports(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refraim.heartbeat_refraim_export(UUID, UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION refraim.list_stale_refraim_exports(INTEGER, INTEGER)
  TO service_role;

DO $privilege_check$
BEGIN
  IF pg_catalog.has_function_privilege(
    'anon',
    'refraim.heartbeat_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'refraim.heartbeat_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'refraim.heartbeat_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'invalid heartbeat_refraim_export privileges';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'refraim.list_stale_refraim_exports(integer,integer)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'refraim.list_stale_refraim_exports(integer,integer)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'refraim.list_stale_refraim_exports(integer,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'invalid list_stale_refraim_exports privileges';
  END IF;
END;
$privilege_check$;
