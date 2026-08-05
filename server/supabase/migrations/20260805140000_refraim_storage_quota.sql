-- Nothing bounded how much a single user could store. The multer cap bounds
-- one request at 100 MB; repeat it and the bucket grows without limit, at our
-- cost, for material we are contractually obliged to keep private.
--
-- Sizes are recorded per video so the total drops when a video is deleted,
-- which already removes both the source object and every render.

ALTER TABLE refraim.videos
  ADD COLUMN IF NOT EXISTS source_bytes BIGINT;

-- Rows uploaded before this column existed have no size. They are counted as
-- zero rather than blocking, and the comment says so out loud because an
-- under-count is the safe direction here and a surprise later otherwise.
COMMENT ON COLUMN refraim.videos.source_bytes IS
  'Bytes of the uploaded source. NULL for videos created before the quota shipped; counted as 0.';

CREATE INDEX IF NOT EXISTS idx_videos_user_id_source_bytes
  ON refraim.videos (user_id)
  INCLUDE (source_bytes);

/**
 * Total stored source bytes for one user.
 *
 * Summed in the database rather than by reading every row into the API: the
 * answer is one number and the row count is unbounded by design.
 */
CREATE OR REPLACE FUNCTION refraim.user_storage_bytes(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(pg_catalog.sum(video.source_bytes), 0)::BIGINT
    FROM refraim.videos AS video
   WHERE video.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION refraim.user_storage_bytes(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refraim.user_storage_bytes(UUID) TO service_role;

DO $privilege_check$
BEGIN
  IF pg_catalog.has_function_privilege('anon', 'refraim.user_storage_bytes(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', 'refraim.user_storage_bytes(uuid)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'refraim.user_storage_bytes(uuid)', 'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'invalid user_storage_bytes privileges';
  END IF;
END;
$privilege_check$;
