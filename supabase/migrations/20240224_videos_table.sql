-- Create videos table
CREATE TABLE IF NOT EXISTS public.videos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    original_url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    platform_outputs JSONB DEFAULT NULL,
    processing_metadata JSONB DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create processing_jobs table
CREATE TABLE IF NOT EXISTS public.processing_jobs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    video_id UUID NOT NULL REFERENCES public.videos(id),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    platforms TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own videos" 
    ON public.videos
    FOR SELECT 
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users can create their own videos" 
    ON public.videos
    FOR INSERT 
    TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own videos" 
    ON public.videos
    FOR UPDATE 
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own videos" 
    ON public.videos
    FOR DELETE 
    TO authenticated
    USING (user_id = auth.uid());

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_videos_updated_at
    BEFORE UPDATE
    ON public.videos
    FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
