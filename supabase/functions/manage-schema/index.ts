import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import { corsHeaders } from '../_shared/cors.ts'

const schema = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create videos table if not exists
CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    original_url TEXT NOT NULL,
    processed_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    platforms TEXT[] NOT NULL DEFAULT '{}',
    title TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes if not exists
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

-- Add trigger for updated_at if not exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_videos_updated_at ON videos;
CREATE TRIGGER update_videos_updated_at
    BEFORE UPDATE ON videos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can only access their own videos" ON videos;
DROP POLICY IF EXISTS "Users can only insert their own videos" ON videos;
DROP POLICY IF EXISTS "Users can only update their own videos" ON videos;
DROP POLICY IF EXISTS "Users can only delete their own videos" ON videos;

-- Create granular policies
CREATE POLICY "Users can only access their own videos"
    ON videos FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own videos"
    ON videos FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own videos"
    ON videos FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own videos"
    ON videos FOR DELETE
    USING (auth.uid() = user_id);
`

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
          persistSession: false
        }
      }
    )

    // Only allow POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parse request body
    const { action } = await req.json()

    // Handle different actions
    switch (action) {
      case 'init':
        // Execute schema
        const { error: schemaError } = await supabaseClient.rpc('exec_sql', {
          sql: schema
        })

        if (schemaError) {
          console.error('Error executing schema:', schemaError)
          throw new Error(`Failed to execute schema: ${schemaError.message}`)
        }

        // Refresh schema cache
        const { error: refreshError } = await supabaseClient.rpc('exec_sql', {
          sql: 'NOTIFY pgrst, \'reload schema\';'
        })

        if (refreshError) {
          console.error('Error refreshing schema:', refreshError)
          throw new Error(`Failed to refresh schema: ${refreshError.message}`)
        }

        // Wait for cache to refresh
        await new Promise(resolve => setTimeout(resolve, 1000))

        return new Response(
          JSON.stringify({ message: 'Schema initialized successfully' }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )

      case 'refresh':
        // Refresh schema cache
        const { error: cacheError } = await supabaseClient.rpc('exec_sql', {
          sql: 'NOTIFY pgrst, \'reload schema\';'
        })

        if (cacheError) {
          console.error('Error refreshing schema:', cacheError)
          throw new Error(`Failed to refresh schema: ${cacheError.message}`)
        }

        // Wait for cache to refresh
        await new Promise(resolve => setTimeout(resolve, 1000))

        return new Response(
          JSON.stringify({ message: 'Schema cache refreshed successfully' }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
    }
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
