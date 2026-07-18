-- Couple refrAIm plan allowance changes to the durable processing job.
-- Both functions run as one Postgres transaction and are service-role only.

CREATE OR REPLACE FUNCTION public.reserve_refraim_export(
  p_job_id UUID,
  p_user_id UUID,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_status TEXT;
  v_used INTEGER;
BEGIN
  SELECT status
    INTO v_job_status
    FROM public.processing_jobs
   WHERE id = p_job_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'processing job not found';
  END IF;

  SELECT exports_this_month
    INTO v_used
    FROM public.user_billing
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing row not found';
  END IF;

  -- A lost HTTP response may replay the same job id. The committed job phase
  -- is the reservation receipt, so never increment it a second time.
  IF v_job_status = 'processing_plan_quota' THEN
    RETURN jsonb_build_object('reserved', TRUE, 'used', v_used);
  END IF;

  IF v_job_status <> 'reserving_plan_quota' THEN
    RETURN jsonb_build_object('reserved', FALSE, 'used', v_used);
  END IF;

  IF p_limit >= 0 AND v_used >= p_limit THEN
    RETURN jsonb_build_object('reserved', FALSE, 'used', v_used);
  END IF;

  v_used := v_used + 1;
  UPDATE public.user_billing
     SET exports_this_month = v_used,
         updated_at = timezone('utc'::text, now())
   WHERE user_id = p_user_id;

  UPDATE public.processing_jobs
     SET status = 'processing_plan_quota',
         updated_at = timezone('utc'::text, now())
   WHERE id = p_job_id
     AND user_id = p_user_id;

  RETURN jsonb_build_object('reserved', TRUE, 'used', v_used);
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_refraim_plan_quota_export(
  p_user_id UUID,
  p_video_id UUID,
  p_job_id UUID,
  p_legacy_missing_job BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_status TEXT;
  v_job_created_at TIMESTAMPTZ;
  v_video_status TEXT;
  v_outputs JSONB;
  v_metadata JSONB;
  v_video_updated_at TIMESTAMPTZ;
  v_used INTEGER;
  v_reset_at TIMESTAMPTZ;
  v_reservation_at TIMESTAMPTZ;
  v_owns_video BOOLEAN := FALSE;
  v_reserved BOOLEAN := FALSE;
  v_refunded BOOLEAN := FALSE;
  v_synthetic_job BOOLEAN := FALSE;
BEGIN
  SELECT status, created_at
    INTO v_job_status, v_job_created_at
    FROM public.processing_jobs
   WHERE id = p_job_id
     AND video_id = p_video_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND AND p_legacy_missing_job THEN
    v_synthetic_job := TRUE;
    INSERT INTO public.processing_jobs (
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

    SELECT status, created_at
      INTO v_job_status, v_job_created_at
      FROM public.processing_jobs
     WHERE id = p_job_id
       AND video_id = p_video_id
       AND user_id = p_user_id
     FOR UPDATE;
  END IF;

  IF v_job_status IS NULL THEN
    RETURN jsonb_build_object('recovered', FALSE, 'refunded', FALSE);
  END IF;

  IF v_job_status = 'failed_allowance_refunded' THEN
    RETURN jsonb_build_object('recovered', TRUE, 'refunded', TRUE);
  END IF;

  -- Older releases used phase names that did not record the billing path.
  -- They cannot be reconstructed exactly after a crash. Route them through
  -- the same one-shot receipt and prefer a bounded user credit over silently
  -- consuming an allowance with no output.
  IF p_legacy_missing_job AND lower(v_job_status) IN (
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
    RETURN jsonb_build_object('recovered', FALSE, 'refunded', FALSE);
  END IF;

  SELECT status, platform_outputs, processing_metadata, updated_at
    INTO v_video_status, v_outputs, v_metadata, v_video_updated_at
    FROM public.videos
   WHERE id = p_video_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('recovered', FALSE, 'refunded', FALSE);
  END IF;

  -- If publication acquired the video row first, preserve the delivered
  -- output and only converge the stale job marker.
  IF EXISTS (
    SELECT 1
      FROM jsonb_each(COALESCE(v_outputs, '{}'::jsonb)) AS output
     WHERE output.value->>'status' = 'complete'
  ) THEN
    UPDATE public.processing_jobs
       SET status = CASE WHEN lower(v_video_status) = 'failed' THEN 'failed' ELSE 'completed' END,
           progress = 100,
           error = NULL,
           updated_at = timezone('utc'::text, now())
     WHERE id = p_job_id
       AND user_id = p_user_id;
    RETURN jsonb_build_object('recovered', TRUE, 'refunded', FALSE);
  END IF;

  v_owns_video := COALESCE(v_metadata->>'active_job_id', '') = p_job_id::TEXT;
  v_reservation_at := CASE
    WHEN v_synthetic_job THEN v_video_updated_at
    ELSE v_job_created_at
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

  IF v_reserved THEN
    SELECT exports_this_month, exports_reset_at
      INTO v_used, v_reset_at
      FROM public.user_billing
     WHERE user_id = p_user_id
     FOR UPDATE;

    IF FOUND
      AND v_used > 0
      AND (v_reset_at IS NULL OR v_reservation_at >= v_reset_at)
    THEN
      UPDATE public.user_billing
         SET exports_this_month = v_used - 1,
             updated_at = timezone('utc'::text, now())
       WHERE user_id = p_user_id;
      v_refunded := TRUE;
    END IF;
  END IF;

  IF v_owns_video THEN
    UPDATE public.videos
       SET status = 'failed',
           platform_outputs = NULL,
           processing_metadata = NULL,
           updated_at = timezone('utc'::text, now())
     WHERE id = p_video_id
       AND user_id = p_user_id;
  END IF;

  UPDATE public.processing_jobs
     SET status = CASE WHEN v_refunded THEN 'failed_allowance_refunded' ELSE 'failed' END,
         progress = 100,
         error = CASE
           WHEN v_refunded THEN 'This export did not complete. Your allowance was restored. Please retry.'
           ELSE 'This export did not complete. Please retry.'
         END,
         updated_at = timezone('utc'::text, now())
   WHERE id = p_job_id
     AND user_id = p_user_id;

  RETURN jsonb_build_object('recovered', TRUE, 'refunded', v_refunded);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_refraim_export(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_refraim_plan_quota_export(UUID, UUID, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_refraim_export(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_refraim_plan_quota_export(UUID, UUID, UUID, BOOLEAN) TO service_role;
