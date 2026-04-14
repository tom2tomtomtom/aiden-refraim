import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables');
}

console.log('Initializing Supabase clients:', {
  url: process.env.SUPABASE_URL,
  hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  hasAnonKey: !!process.env.SUPABASE_ANON_KEY
});

// Create auth client for JWT validation
export const authClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    db: {
      schema: 'refraim'
    }
  }
);

// Create admin client for server-side operations
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    db: {
      schema: 'refraim'
    }
  }
);
