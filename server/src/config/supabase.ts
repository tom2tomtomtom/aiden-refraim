import { createClient } from '@supabase/supabase-js';
import { getValidatedSupabaseConfig } from '../lib/supabase-env';

const { url, serviceRoleKey, anonKey } = getValidatedSupabaseConfig();

console.log('Initializing Supabase clients:', {
  url,
  hasServiceKey: !!serviceRoleKey,
  hasAnonKey: !!anonKey
});

// Create auth client for JWT validation
export const authClient = createClient(
  url,
  anonKey,
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
  url,
  serviceRoleKey,
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
