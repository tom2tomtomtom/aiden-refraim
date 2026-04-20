import { createClient } from '@supabase/supabase-js';
import { getValidatedSupabaseConfig } from '../lib/supabase-env';

const { url, serviceRoleKey } = getValidatedSupabaseConfig();

console.log('Initializing Supabase service-role client:', {
  url,
  hasServiceKey: !!serviceRoleKey,
});

// Service-role client for server-side database operations. All routes
// trust the Gateway JWT (verified by requireAuth) for user identity and
// enforce user_id filtering in app code — we do not rely on RLS.
export const supabase = createClient(
  url,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: {
      schema: 'refraim',
    },
  }
);
