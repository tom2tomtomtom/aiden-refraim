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

        // 2. Create exec_sql function directly
        console.log('Creating exec_sql function...');
        try {
            await pool.query(`
                CREATE OR REPLACE FUNCTION exec_sql(sql text)
                RETURNS void AS $$
                BEGIN
                    EXECUTE sql;
                END;
                $$ LANGUAGE plpgsql SECURITY DEFINER;
            `);
            console.log('exec_sql function created successfully');
        } catch (error) {
            console.warn('Note: exec_sql function creation failed (may already exist):', error);
        } finally {
            await pool.end();
        }
        // 1. Create exec_sql function if it doesn't exist
        console.log('Creating exec_sql function...');
        const { error: funcError } = await supabase.rpc('exec_sql', {
            sql: `
                CREATE OR REPLACE FUNCTION exec_sql(sql text)
                RETURNS void AS $$
                BEGIN
                    EXECUTE sql;
                END;
                $$ LANGUAGE plpgsql SECURITY DEFINER;
            `
        });

        if (funcError) {
            console.warn('Note: exec_sql function may already exist:', funcError);
        }

        // 2. Read schema file
        console.log('Reading schema file...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // 3. Execute schema
        console.log('Executing schema...');
        const { error: schemaError } = await supabase.rpc('exec_sql', {
            sql: schemaSql
        });

        if (schemaError) {
            console.error('Error executing schema:', schemaError);
            throw new Error(`Failed to execute schema: ${schemaError.message}`);
        }

        // 4. Set up RLS policies
        console.log('Setting up RLS policies...');
        const { error: rlsError } = await supabase.rpc('exec_sql', {
            sql: `
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
        });

        if (rlsError) {
            console.error('Error setting up RLS policies:', rlsError);
            throw new Error(`Failed to set up RLS policies: ${rlsError.message}`);
        }

        // 5. Refresh schema cache
        console.log('Refreshing schema cache...');
        await supabase.rpc('exec_sql', {
            sql: 'NOTIFY pgrst, \'reload schema\';'
        });

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
