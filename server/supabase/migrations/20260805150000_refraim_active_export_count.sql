-- Nothing capped how many exports one user could have in flight at once. The
-- per-video fence (processing_metadata.active_job_id) stops two runs claiming
-- the same video; it says nothing about one account starting twenty videos and
-- taking the whole container's CPU with it.
--
-- Counting is lease-aware on purpose. A job abandoned by a dead worker must
-- not hold a concurrency slot forever, which is exactly the failure F-052's
-- reaper exists to clear — so the two use the same definition of "still
-- running": a live lease, or, for jobs predating leases, recent progress.

/**
 * How many exports this user genuinely has running.
 *
 * Mirrors the staleness rule in list_stale_refraim_exports. A job that the
 * reaper would consider reapable is not counted, so a stuck run costs the user
 * a slot only until the next sweep, and never permanently.
 */
CREATE OR REPLACE FUNCTION refraim.count_active_refraim_exports(
  p_user_id UUID,
  p_legacy_stale_seconds INTEGER DEFAULT 1800
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pg_catalog.count(*)::INTEGER
    FROM refraim.processing_jobs AS job
   WHERE job.user_id = p_user_id
     AND pg_catalog.lower(job.status) NOT IN (
           'completed', 'complete', 'failed', 'failed_compensated',
           'failed_allowance_refunded', 'error'
         )
     AND (
       CASE
         WHEN job.lease_expires_at IS NOT NULL THEN job.lease_expires_at >= pg_catalog.now()
         ELSE COALESCE(job.updated_at, job.created_at)
           >= pg_catalog.now() - pg_catalog.make_interval(secs => p_legacy_stale_seconds)
       END
     );
$$;

CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_active
  ON refraim.processing_jobs (user_id)
  WHERE pg_catalog.lower(status) NOT IN (
    'completed', 'complete', 'failed', 'failed_compensated',
    'failed_allowance_refunded', 'error'
  );

REVOKE ALL ON FUNCTION refraim.count_active_refraim_exports(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refraim.count_active_refraim_exports(UUID, INTEGER) TO service_role;

DO $privilege_check$
BEGIN
  IF pg_catalog.has_function_privilege(
    'anon', 'refraim.count_active_refraim_exports(uuid,integer)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'refraim.count_active_refraim_exports(uuid,integer)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', 'refraim.count_active_refraim_exports(uuid,integer)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'invalid count_active_refraim_exports privileges';
  END IF;
END;
$privilege_check$;
