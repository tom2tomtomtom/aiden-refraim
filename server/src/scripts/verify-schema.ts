import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { supabase } from '../config/supabase';

async function verifySchema() {
  try {
    console.log('Verifying database schema...');

    // Check if videos table exists
    const { data: tables, error: tableError } = await supabase
      .from('videos')
      .select('id')
      .limit(1);

    if (tableError) {
      console.log('Videos table not found, creating schema...');
      
      // Create videos table
      const { error: schemaError } = await supabase.rpc('exec_sql', {
        sql: `
          -- Create videos table
          CREATE TABLE IF NOT EXISTS public.videos (
              id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
              user_id UUID NOT NULL REFERENCES auth.users(id),
              original_url TEXT NOT NULL,
              title TEXT,
              description TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              platforms TEXT[] NOT NULL DEFAULT '{}',
              created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
          );

          -- Enable RLS
          ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

          -- Create policies
          CREATE POLICY IF NOT EXISTS "Users can view their own videos" 
              ON public.videos
              FOR SELECT 
              TO authenticated
              USING (user_id = auth.uid());

          CREATE POLICY IF NOT EXISTS "Users can create their own videos" 
              ON public.videos
              FOR INSERT 
              TO authenticated
              WITH CHECK (user_id = auth.uid());

          CREATE POLICY IF NOT EXISTS "Users can update their own videos" 
              ON public.videos
              FOR UPDATE 
              TO authenticated
              USING (user_id = auth.uid())
              WITH CHECK (user_id = auth.uid());

          CREATE POLICY IF NOT EXISTS "Users can delete their own videos" 
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

          CREATE TRIGGER IF NOT EXISTS update_videos_updated_at
              BEFORE UPDATE
              ON public.videos
              FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
        `
      });

      if (schemaError) {
        throw new Error(`Failed to create schema: ${schemaError.message}`);
      }

      console.log('Schema created successfully');
    } else {
      console.log('Videos table exists');
    }

    // Verify storage bucket
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (bucketsError) throw bucketsError;

    const videoBucket = buckets.find(b => b.name === 'videos');
    if (!videoBucket) {
      console.log('Creating videos bucket...');
      const { error: createError } = await supabase.storage.createBucket('videos', {
        public: true,
        fileSizeLimit: 500000000 // 500MB
      });
      if (createError) throw createError;
      console.log('Videos bucket created');
    } else {
      console.log('Videos bucket exists');
    }

    console.log('Schema verification complete');
  } catch (error) {
    console.error('Error verifying schema:', error);
    process.exit(1);
  }
}

verifySchema();
