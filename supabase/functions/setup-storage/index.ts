import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { corsHeaders } from '../_shared/cors.ts'

console.log('Setting up storage configuration...')

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Create public bucket if it doesn't exist
    const { data: buckets, error: listError } = await supabaseClient.storage.listBuckets()
    if (listError) throw listError

    const bucketName = 'videos'
    const bucketExists = buckets.some(b => b.name === bucketName)

    if (!bucketExists) {
      const { error: createError } = await supabaseClient.storage.createBucket(bucketName, {
        public: true,
        allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo'],
        fileSizeLimit: '500MB'
      })
      if (createError) throw createError
    } else {
      // Update existing bucket to be public
      const { error: updateError } = await supabaseClient.storage.updateBucket(bucketName, {
        public: true,
        allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo'],
        fileSizeLimit: '500MB'
      })
      if (updateError) throw updateError
    }

    // Create RLS policies for the storage.objects table
    const { error: policyError } = await supabaseClient.rpc('exec_sql', {
      sql: `
        -- Allow authenticated users to upload videos
        CREATE POLICY IF NOT EXISTS "Users can upload videos" 
        ON storage.objects FOR INSERT 
        TO authenticated 
        WITH CHECK (
          bucket_id = 'videos' 
          AND (storage.extension(name) = 'mp4' OR storage.extension(name) = 'mov' OR storage.extension(name) = 'avi')
        );

        -- Allow users to update their own videos
        CREATE POLICY IF NOT EXISTS "Users can update their videos" 
        ON storage.objects FOR UPDATE 
        TO authenticated 
        USING (bucket_id = 'videos' AND owner = auth.uid())
        WITH CHECK (bucket_id = 'videos' AND owner = auth.uid());

        -- Allow users to delete their own videos
        CREATE POLICY IF NOT EXISTS "Users can delete their videos" 
        ON storage.objects FOR DELETE 
        TO authenticated 
        USING (bucket_id = 'videos' AND owner = auth.uid());

        -- Allow public access to videos bucket
        CREATE POLICY IF NOT EXISTS "Public can view videos" 
        ON storage.objects FOR SELECT 
        TO public 
        USING (bucket_id = 'videos');
      `
    })
    if (policyError) throw policyError

    return new Response(
      JSON.stringify({ message: 'Storage configuration completed successfully' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
