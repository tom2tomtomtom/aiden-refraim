-- Keep private video reads behind server-minted signed URLs in every environment.
DROP POLICY IF EXISTS "Public can view videos" ON storage.objects;
