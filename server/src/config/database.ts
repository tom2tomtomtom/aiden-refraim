import { supabase } from './supabase';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

export async function initializeDatabase() {
    console.log('Starting database initialization...');

    try {
        // 1. Create direct database connection
        console.log('Creating database connection...');
        const pool = new Pool({
            connectionString: process.env.SUPABASE_POSTGRES_URL
        });

        // 2. Read schema file
        console.log('Reading schema file...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // 3. Execute schema directly via pool
        console.log('Executing schema...');
        try {
            await pool.query(schemaSql);
            console.log('Schema executed successfully');
        } catch (error) {
            console.error('Error executing schema:', error);
            throw new Error(`Failed to execute schema: ${error instanceof Error ? error.message : String(error)}`);
        }

        // 4. Set up RLS policies
        console.log('Setting up RLS policies...');
        try {
            await pool.query(`
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
            `);
            console.log('RLS policies set up successfully');
        } catch (error) {
            console.error('Error setting up RLS policies:', error);
            throw new Error(`Failed to set up RLS policies: ${error instanceof Error ? error.message : String(error)}`);
        }

        // 5. Refresh schema cache
        console.log('Refreshing schema cache...');
        await pool.query("NOTIFY pgrst, 'reload schema';");

        await pool.end();

        // Wait for cache to refresh
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 6. Verify setup
        console.log('Verifying database setup...');
        const { error: verifyError } = await supabase
            .from('videos')
            .select('id')
            .limit(1);

        if (verifyError) {
            console.error('Database verification failed:', verifyError);
            throw new Error(`Database verification failed: ${verifyError.message}`);
        }

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization failed:', error);
        throw error;
    }
}
