import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { supabase } from '../config/supabase';

async function setupStorage() {
  try {
    console.log('Setting up storage configuration...');

    // Create or update bucket
    const bucketName = 'videos';
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) throw listError;

    const bucketExists = buckets.some(b => b.name === bucketName);
    if (!bucketExists) {
      console.log('Creating bucket:', bucketName);
      const { error: createError } = await supabase.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: 500000000 // 500MB in bytes
      });
      if (createError) throw createError;
    } else {
      console.log('Updating bucket:', bucketName);
      const { error: updateError } = await supabase.storage.updateBucket(bucketName, {
        public: true,
        fileSizeLimit: 500000000 // 500MB in bytes
      });
      if (updateError) throw updateError;
    }

    // Create RLS policies
    const { error: policyError } = await supabase.rpc('exec_sql', {
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
    });
    if (policyError) throw policyError;

    console.log('Storage configuration completed successfully');
  } catch (error) {
    console.error('Error setting up storage:', error);
    process.exit(1);
  }
}

setupStorage();
