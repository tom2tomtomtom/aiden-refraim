import { supabase } from '../config/supabase';
import { initializeDatabase } from '../config/database';

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'videos';

export class InitializationService {
  static async initialize() {
    try {
      await this.initializeStorage();
      await this.initializeDatabase();
    } catch (error) {
      console.error('Error during initialization:', error);
      throw error;
    }
  }

  private static async initializeStorage() {
    try {
      // Check if bucket exists
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      
      if (listError) {
        throw listError;
      }

      const bucketExists = buckets.some(bucket => bucket.name === STORAGE_BUCKET);

      if (!bucketExists) {
        // Create the bucket if it doesn't exist
        const { data, error: createError } = await supabase.storage.createBucket(STORAGE_BUCKET, {
          public: true,
          allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/x-msvideo']
        });

        if (createError) {
          throw createError;
        }

        console.log(`Created storage bucket: ${STORAGE_BUCKET}`);
      } else {
        console.log(`Storage bucket ${STORAGE_BUCKET} already exists`);
      }

      console.log(`Storage bucket ${STORAGE_BUCKET} ready to use`);
    } catch (error) {
      console.error('Error initializing storage:', error);
      throw error;
    }
  }

  private static async initializeDatabase() {
    try {
      await initializeDatabase();
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
    try {
      // Enable UUID extension
      const { error: extensionError } = await supabase.rpc('create_extension', {
        name: 'uuid-ossp'
      });

      if (extensionError) {
        console.warn('UUID extension might already be enabled:', extensionError);
      }

      // Check if videos table exists. If it doesn't, bail with a clear
      // error — we used to execute server/src/config/schema.sql here via
      // supabase.query(), but supabase-js has no .query() method and
      // this branch has been dead since the client was swapped in.
      // Schema is managed by Supabase migrations in production; for
      // local dev, run the migrations manually.
      const { error: existsError } = await supabase
        .from('videos')
        .select('id')
        .limit(1);

      if (existsError?.message?.includes('relation "videos" does not exist')) {
        throw new Error(
          'videos table missing — run supabase migrations (supabase/migrations/*.sql) against the target project'
        );
      } else {
        console.log('Videos table already exists');
      }
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }
}
