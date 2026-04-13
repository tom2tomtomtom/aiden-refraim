import { Router } from 'express';
import { supabase } from '../config/supabase';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Admin routes are dev-only
if (process.env.NODE_ENV !== 'production') {
  // Refresh schema cache
  router.post('/refresh-schema', requireAuth as any, async (req, res): Promise<void> => {
    try {
      console.log('Refreshing schema cache...');

      const pool = new Pool({
        connectionString: process.env.SUPABASE_POSTGRES_URL,
      });

      await pool.query("NOTIFY pgrst, 'reload schema';");
      await pool.end();

      // Wait for cache to refresh
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify schema
      const { error: verifyError } = await supabase
        .from('videos')
        .select('id')
        .limit(1);

      if (verifyError) {
        console.error('Schema verification failed:', verifyError);
        res.status(500).json({
          error: 'Schema verification failed',
          details: verifyError.message
        });
        return;
      }

      console.log('Schema cache refreshed successfully');
      res.json({ message: 'Schema cache refreshed successfully' });
    } catch (error) {
      console.error('Error refreshing schema:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const pool = new Pool({
    connectionString: process.env.SUPABASE_POSTGRES_URL,
  });

  // Recreate tables
  router.post('/recreate-tables', requireAuth as any, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Drop and recreate videos table
      await client.query(`
        DROP TABLE IF EXISTS videos;

        CREATE TABLE videos (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id TEXT NOT NULL,
          original_url TEXT NOT NULL,
          processed_url TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          error TEXT,
          platforms JSONB NOT NULL DEFAULT '[]',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Add RLS policies
        ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

        CREATE POLICY "Users can only access their own videos"
          ON videos
          FOR ALL
          USING (user_id = current_setting('user.id', TRUE));
      `);

      await client.query('COMMIT');
      res.json({ message: 'Tables recreated successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error recreating tables:', error);
      res.status(500).json({ error: 'Failed to recreate tables', details: error instanceof Error ? error.message : String(error) });
    } finally {
      client.release();
    }
  });
} else {
  router.all('*', (_req: any, res: any) => res.status(404).json({ error: 'Not available in production' }));
}

export default router;
