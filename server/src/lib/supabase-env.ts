/**
 * Supabase env validation.
 *
 * Fails loudly at startup if the Supabase URL is missing or points at an
 * unexpected project. Guards against the class of bug where a silent
 * `|| 'https://...supabase.co'` fallback redirects the server to a
 * decommissioned project when Railway env is misconfigured.
 *
 * Expected project ref for the AIDEN hub platform: bktujlufguenjytbdndn
 */

const EXPECTED_PROJECT_REFS = new Set([
  'bktujlufguenjytbdndn', // aiden-platform (canonical hub DB)
]);

interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
}

export function getValidatedSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error(
      'SUPABASE_URL is not set. No hardcoded fallback is provided. ' +
        'Set it on the Railway server service to match the expected project.'
    );
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. No hardcoded fallback is provided.');
  }
  if (!anonKey) {
    throw new Error('SUPABASE_ANON_KEY is not set. No hardcoded fallback is provided.');
  }

  const match = url.match(/^https:\/\/([^.]+)\.supabase\.co/);
  const ref = match?.[1];
  if (!ref || !EXPECTED_PROJECT_REFS.has(ref)) {
    throw new Error(
      `SUPABASE_URL points at an unexpected project (ref: ${ref ?? 'unparseable'}). ` +
        `Expected one of: ${Array.from(EXPECTED_PROJECT_REFS).join(', ')}. ` +
        'Update Railway env or add the new ref to EXPECTED_PROJECT_REFS.'
    );
  }

  return { url, serviceRoleKey, anonKey };
}

export function validateSupabaseEnvOrExit(): void {
  try {
    getValidatedSupabaseConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[STARTUP] Supabase env validation failed: ${msg}`);
    process.exit(1);
  }
}
