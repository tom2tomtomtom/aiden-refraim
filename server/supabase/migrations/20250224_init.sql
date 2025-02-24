-- Create videos table
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  title TEXT,
  description TEXT,
  original_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOADED',
  platform_outputs JSONB,
  processing_metadata JSONB,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create processing_jobs table
CREATE TABLE processing_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  platforms TEXT[] NOT NULL DEFAULT '{}',
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable Row Level Security
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own videos"
  ON videos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own videos"
  ON videos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own videos"
  ON videos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own videos"
  ON videos FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own processing jobs"
  ON processing_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own processing jobs"
  ON processing_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own processing jobs"
  ON processing_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own processing jobs"
  ON processing_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers
CREATE TRIGGER update_videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_processing_jobs_updated_at
  BEFORE UPDATE ON processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
