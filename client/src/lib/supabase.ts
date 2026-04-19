import { createClient } from '@supabase/supabase-js';

// Canonical AIDEN hub project ref. Vite bakes VITE_SUPABASE_URL at build
// time, so mismatches here mean the Docker/Netlify build was produced with
// the wrong env. Fail loud at import so it surfaces in the console / Sentry
// instead of silently connecting to the wrong DB.
const EXPECTED_PROJECT_REFS = new Set(['bktujlufguenjytbdndn']);

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const msg = 'Missing Supabase environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)';
  console.error(`[SUPABASE] ${msg}`);
  throw new Error(msg);
}

const refMatch = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co/);
const ref = refMatch?.[1];
if (!ref || !EXPECTED_PROJECT_REFS.has(ref)) {
  const msg =
    `VITE_SUPABASE_URL points at an unexpected project (ref: ${ref ?? 'unparseable'}). ` +
    `Expected one of: ${Array.from(EXPECTED_PROJECT_REFS).join(', ')}.`;
  console.error(`[SUPABASE] ${msg}`);
  throw new Error(msg);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  db: {
    schema: 'refraim'
  }
});
