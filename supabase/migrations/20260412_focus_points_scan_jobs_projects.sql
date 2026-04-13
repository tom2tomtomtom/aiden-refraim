-- Migration: Add focus_points, scan_jobs, and projects tables
-- Date: 2026-04-12
-- Description: Adds focus point regions, AI scan job tracking, and named project persistence

-- ============================================================================
-- 1. focus_points
-- ============================================================================

CREATE TABLE focus_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    time_start NUMERIC NOT NULL,
    time_end NUMERIC NOT NULL,
    x NUMERIC NOT NULL,
    y NUMERIC NOT NULL,
    width NUMERIC NOT NULL,
    height NUMERIC NOT NULL,
    description TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    position_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    CONSTRAINT chk_focus_points_time CHECK (time_start < time_end),
    CONSTRAINT chk_focus_points_x CHECK (x >= 0 AND x <= 100),
    CONSTRAINT chk_focus_points_y CHECK (y >= 0 AND y <= 100),
    CONSTRAINT chk_focus_points_width CHECK (width >= 0 AND width <= 100),
    CONSTRAINT chk_focus_points_height CHECK (height >= 0 AND height <= 100),
    CONSTRAINT chk_focus_points_source CHECK (source IN ('manual', 'ai_detection'))
);

-- Indexes
CREATE INDEX idx_focus_points_video_id ON focus_points(video_id);
CREATE INDEX idx_focus_points_video_time ON focus_points(video_id, time_start);

-- RLS
ALTER TABLE focus_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own focus points"
    ON focus_points FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own focus points"
    ON focus_points FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own focus points"
    ON focus_points FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own focus points"
    ON focus_points FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_focus_points_updated_at
    BEFORE UPDATE ON focus_points
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 2. scan_jobs
-- ============================================================================

CREATE TABLE scan_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    scan_options JSONB DEFAULT '{}',
    detected_subjects JSONB DEFAULT '[]',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),

    CONSTRAINT chk_scan_jobs_status CHECK (status IN ('pending', 'scanning', 'completed', 'failed')),
    CONSTRAINT chk_scan_jobs_progress CHECK (progress >= 0 AND progress <= 100)
);

-- Indexes
CREATE INDEX idx_scan_jobs_video_id ON scan_jobs(video_id);
CREATE INDEX idx_scan_jobs_user_id ON scan_jobs(user_id);
CREATE INDEX idx_scan_jobs_status ON scan_jobs(status);

-- RLS
ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scan jobs"
    ON scan_jobs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scan jobs"
    ON scan_jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scan jobs"
    ON scan_jobs FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own scan jobs"
    ON scan_jobs FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_scan_jobs_updated_at
    BEFORE UPDATE ON scan_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 3. projects
-- ============================================================================

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    name TEXT NOT NULL,
    video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Indexes
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_video_id ON projects(video_id);

-- RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects"
    ON projects FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects"
    ON projects FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
    ON projects FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
    ON projects FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
