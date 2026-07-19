-- Couple refrAIm plan allowance changes to a durable reservation receipt.
-- The server client and PostgREST API are scoped to the refraim schema.

CREATE TABLE IF NOT EXISTS refraim.export_quota_reservations (
  job_id UUID PRIMARY KEY REFERENCES refraim.processing_jobs(id) ON DELETE CASCADE,
  video_id UUID NOT NULL,
  user_id UUID NOT NULL,
  quota_period_started_at TIMESTAMPTZ NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  refunded_at TIMESTAMPTZ
);

ALTER TABLE refraim.export_quota_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE refraim.export_quota_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE refraim.export_quota_reservations TO service_role;

DROP POLICY IF EXISTS "Service role manages quota reservations"
  ON refraim.export_quota_reservations;
CREATE POLICY "Service role manages quota reservations"
  ON refraim.export_quota_reservations
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE INDEX IF NOT EXISTS idx_export_quota_reservations_user_id
  ON refraim.export_quota_reservations(user_id);

CREATE OR REPLACE FUNCTION refraim.reserve_refraim_export(
  p_job_id UUID,
  p_user_id UUID,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_status TEXT;
  v_video_id UUID;
  v_used INTEGER;
  v_reset_at TIMESTAMPTZ;
  v_receipt_period TIMESTAMPTZ;
  v_receipt_refunded_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  SELECT status, video_id
    INTO v_job_status, v_video_id
    FROM refraim.processing_jobs
   WHERE id = p_job_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing job not found';
  END IF;

  SELECT exports_this_month, exports_reset_at
    INTO v_used, v_reset_at
    FROM refraim.user_billing
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing row not found';
  END IF;

  SELECT quota_period_started_at, refunded_at
    INTO v_receipt_period, v_receipt_refunded_at
    FROM refraim.export_quota_reservations
   WHERE job_id = p_job_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_receipt_refunded_at IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object('reserved', FALSE, 'used', v_used);
    END IF;

    IF v_job_status = 'reserving_plan_quota' THEN
      UPDATE refraim.processing_jobs
         SET status = 'processing_plan_quota',
             updated_at = v_now
       WHERE id = p_job_id
         AND user_id = p_user_id;
      v_job_status := 'processing_plan_quota';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'reserved', v_job_status = 'processing_plan_quota',
      'used', v_used,
      'resets_at', v_receipt_period
    );
  END IF;

  -- Compatibility for a response replay from the earlier job-phase receipt.
  -- New reservations always have the explicit receipt row below.
  IF v_job_status = 'processing_plan_quota' THEN
    RETURN pg_catalog.jsonb_build_object(
      'reserved', TRUE,
      'used', v_used,
      'resets_at', v_reset_at
    );
  END IF;

  IF v_job_status <> 'reserving_plan_quota' THEN
    RETURN pg_catalog.jsonb_build_object('reserved', FALSE, 'used', v_used);
  END IF;

  -- Rollover and increment happen while the same billing row lock is held.
  -- Two first-of-period requests therefore serialize to used=1 and used=2.
  IF v_reset_at IS NULL OR v_reset_at < v_now - INTERVAL '30 days' THEN
    v_used := 0;
    v_reset_at := v_now;
  END IF;

  IF p_limit >= 0 AND v_used >= p_limit THEN
    UPDATE refraim.user_billing
       SET exports_this_month = v_used,
           exports_reset_at = v_reset_at,
           updated_at = v_now
     WHERE user_id = p_user_id;
    RETURN pg_catalog.jsonb_build_object(
      'reserved', FALSE,
      'used', v_used,
      'resets_at', v_reset_at
    );
  END IF;

  v_used := v_used + 1;
  UPDATE refraim.user_billing
     SET exports_this_month = v_used,
         exports_reset_at = v_reset_at,
         updated_at = v_now
   WHERE user_id = p_user_id;

  INSERT INTO refraim.export_quota_reservations (
    job_id,
    video_id,
    user_id,
    quota_period_started_at,
    reserved_at
  ) VALUES (
    p_job_id,
    v_video_id,
    p_user_id,
    v_reset_at,
    v_now
  );

  UPDATE refraim.processing_jobs
     SET status = 'processing_plan_quota',
         updated_at = v_now
   WHERE id = p_job_id
     AND user_id = p_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'reserved', TRUE,
    'used', v_used,
    'resets_at', v_reset_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION refraim.recover_refraim_plan_quota_export(
  p_user_id UUID,
  p_video_id UUID,
  p_job_id UUID,
  p_legacy_missing_job BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job_status TEXT;
  v_job_created_at TIMESTAMPTZ;
  v_job_updated_at TIMESTAMPTZ;
  v_video_status TEXT;
  v_outputs JSONB;
  v_metadata JSONB;
  v_video_updated_at TIMESTAMPTZ;
  v_used INTEGER;
  v_reset_at TIMESTAMPTZ;
  v_reservation_at TIMESTAMPTZ;
  v_receipt_period TIMESTAMPTZ;
  v_receipt_refunded_at TIMESTAMPTZ;
  v_has_receipt BOOLEAN := FALSE;
  v_owns_video BOOLEAN := FALSE;
  v_reserved BOOLEAN := FALSE;
  v_refunded BOOLEAN := FALSE;
  v_synthetic_job BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
  SELECT status, created_at, updated_at
    INTO v_job_status, v_job_created_at, v_job_updated_at
    FROM refraim.processing_jobs
   WHERE id = p_job_id
     AND video_id = p_video_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND AND p_legacy_missing_job THEN
    v_synthetic_job := TRUE;
    INSERT INTO refraim.processing_jobs (
      id, video_id, user_id, platforms, status, progress, error
    ) VALUES (
      p_job_id,
      p_video_id,
      p_user_id,
      '{}',
      'legacy_plan_quota_unknown',
      99,
      'Recovering a legacy interrupted export.'
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT status, created_at, updated_at
      INTO v_job_status, v_job_created_at, v_job_updated_at
      FROM refraim.processing_jobs
     WHERE id = p_job_id
       AND video_id = p_video_id
       AND user_id = p_user_id
     FOR UPDATE;
  END IF;

  IF v_job_status IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('recovered', FALSE, 'refunded', FALSE);
  END IF;

  IF v_job_status = 'failed_allowance_refunded' THEN
    RETURN pg_catalog.jsonb_build_object('recovered', TRUE, 'refunded', TRUE);
  END IF;

  IF p_legacy_missing_job AND pg_catalog.lower(v_job_status) IN (
    'pending', 'running', 'processing', 'publishing_no_charge'
  ) THEN
    v_job_status := 'legacy_plan_quota_unknown';
  END IF;

  IF v_job_status NOT IN (
    'reserving_plan_quota',
    'processing_plan_quota',
    'publishing_plan_quota',
    'publishing_no_charge_plan_quota',
    'legacy_plan_quota_unknown'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('recovered', FALSE, 'refunded', FALSE);
  END IF;

  SELECT status, platform_outputs, processing_metadata, updated_at
    INTO v_video_status, v_outputs, v_metadata, v_video_updated_at
    FROM refraim.videos
   WHERE id = p_video_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('recovered', FALSE, 'refunded', FALSE);
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_each(COALESCE(v_outputs, '{}'::JSONB)) AS output
     WHERE output.value->>'status' = 'complete'
  ) THEN
    UPDATE refraim.processing_jobs
       SET status = CASE
             WHEN pg_catalog.lower(v_video_status) = 'failed' THEN 'failed'
             ELSE 'completed'
           END,
           progress = 100,
           error = NULL,
           updated_at = v_now
     WHERE id = p_job_id
       AND user_id = p_user_id;
    RETURN pg_catalog.jsonb_build_object('recovered', TRUE, 'refunded', FALSE);
  END IF;

  v_owns_video := COALESCE(v_metadata->>'active_job_id', '') = p_job_id::TEXT;

  SELECT quota_period_started_at, refunded_at
    INTO v_receipt_period, v_receipt_refunded_at
    FROM refraim.export_quota_reservations
   WHERE job_id = p_job_id
     AND video_id = p_video_id
     AND user_id = p_user_id
   FOR UPDATE;
  v_has_receipt := FOUND;

  IF v_has_receipt THEN
    v_reserved := v_receipt_refunded_at IS NULL;
  ELSE
    -- Mixed-version jobs lack a receipt. Their reservation transition wrote
    -- updated_at, which is a better legacy boundary than job creation time.
    v_reservation_at := CASE
      WHEN v_synthetic_job THEN v_video_updated_at
      ELSE COALESCE(v_job_updated_at, v_job_created_at)
    END;
    v_reserved := v_job_status IN (
      'processing_plan_quota',
      'publishing_plan_quota',
      'publishing_no_charge_plan_quota',
      'legacy_plan_quota_unknown'
    ) AND (
      v_owns_video
      OR v_job_status IN (
        'publishing_plan_quota',
        'publishing_no_charge_plan_quota',
        'legacy_plan_quota_unknown'
      )
    );
  END IF;

  IF v_reserved THEN
    SELECT exports_this_month, exports_reset_at
      INTO v_used, v_reset_at
      FROM refraim.user_billing
     WHERE user_id = p_user_id
     FOR UPDATE;

    IF FOUND AND v_used > 0 AND (
      (v_has_receipt AND v_reset_at IS NOT DISTINCT FROM v_receipt_period)
      OR (
        NOT v_has_receipt
        AND (v_reset_at IS NULL OR v_reservation_at >= v_reset_at)
      )
    ) THEN
      UPDATE refraim.user_billing
         SET exports_this_month = v_used - 1,
             updated_at = v_now
       WHERE user_id = p_user_id;

      IF v_has_receipt THEN
        UPDATE refraim.export_quota_reservations
           SET refunded_at = v_now
         WHERE job_id = p_job_id
           AND refunded_at IS NULL;
      END IF;
      v_refunded := TRUE;
    END IF;
  END IF;

  IF v_owns_video THEN
    UPDATE refraim.videos
       SET status = 'failed',
           platform_outputs = NULL,
           processing_metadata = NULL,
           updated_at = v_now
     WHERE id = p_video_id
       AND user_id = p_user_id;
  END IF;

  UPDATE refraim.processing_jobs
     SET status = CASE WHEN v_refunded THEN 'failed_allowance_refunded' ELSE 'failed' END,
         progress = 100,
         error = CASE
           WHEN v_refunded THEN 'This export did not complete. Your allowance was restored. Please retry.'
           ELSE 'This export did not complete. Please retry.'
         END,
         updated_at = v_now
   WHERE id = p_job_id
     AND user_id = p_user_id;

  RETURN pg_catalog.jsonb_build_object('recovered', TRUE, 'refunded', v_refunded);
END;
$$;

REVOKE ALL ON FUNCTION refraim.reserve_refraim_export(UUID, UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION refraim.recover_refraim_plan_quota_export(UUID, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refraim.reserve_refraim_export(UUID, UUID, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION refraim.recover_refraim_plan_quota_export(UUID, UUID, UUID, BOOLEAN)
  TO service_role;

DO $privilege_check$
BEGIN
  IF pg_catalog.has_function_privilege(
    'anon',
    'refraim.reserve_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'refraim.reserve_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'refraim.reserve_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'invalid reserve_refraim_export privileges';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon',
    'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'invalid recover_refraim_plan_quota_export privileges';
  END IF;
END;
$privilege_check$;
