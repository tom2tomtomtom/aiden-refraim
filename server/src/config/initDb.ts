import { supabase } from './supabase';

export async function initializeDatabase() {
  try {
    // Create videos table
    const { error: videosError } = await supabase.schema.createTable('videos', {
      id: { type: 'uuid', primaryKey: true, default: 'uuid_generate_v4()' },
      userId: { type: 'text', notNull: true },
      originalUrl: { type: 'text', notNull: true },
      processedUrl: { type: 'text' },
      status: { type: 'text', notNull: true, default: 'pending' },
      error: { type: 'text' },
      platforms: { type: 'jsonb', notNull: true, default: '[]' },
      createdAt: { type: 'timestamp with time zone', notNull: true, default: 'now()' },
      updatedAt: { type: 'timestamp with time zone', notNull: true, default: 'now()' }
    });

    if (videosError) {
      console.error('Error creating videos table:', videosError);
      return;
    }

    // Create RLS policies
    await supabase.schema.createPolicy('videos', {
      name: 'Users can only access their own videos',
      definition: 'auth.uid() = userId'
    });

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}
