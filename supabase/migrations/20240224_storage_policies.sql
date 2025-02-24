-- Enable RLS
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to upload videos
CREATE POLICY "Users can upload videos" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK (
  bucket_id = 'videos' 
  AND (storage.extension(name) = 'mp4' OR storage.extension(name) = 'mov' OR storage.extension(name) = 'avi')
);

-- Allow users to update their own videos
CREATE POLICY "Users can update their videos" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING (bucket_id = 'videos' AND owner = auth.uid())
WITH CHECK (bucket_id = 'videos' AND owner = auth.uid());

-- Allow users to delete their own videos
CREATE POLICY "Users can delete their videos" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (bucket_id = 'videos' AND owner = auth.uid());

-- Allow public access to videos bucket
CREATE POLICY "Public can view videos" 
ON storage.objects FOR SELECT 
TO public 
USING (bucket_id = 'videos');
