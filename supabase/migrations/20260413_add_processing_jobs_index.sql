CREATE INDEX IF NOT EXISTS idx_processing_jobs_video_id ON public.processing_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON public.processing_jobs(user_id);
