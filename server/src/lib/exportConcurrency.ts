/**
 * Cap on exports one user may have running at once.
 *
 * The per-video fence stops two runs claiming the same video. It says nothing
 * about one account starting twenty different videos, which is a single user
 * taking the whole container's CPU and starving everyone else's renders.
 *
 * This is a fairness limit, not a billing one: each export is still charged.
 */

import { supabase } from '../config/supabase';
import { LEGACY_STALE_MS } from './exportLease';

const positiveIntFromEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const MAX_CONCURRENT_EXPORTS_PER_USER = positiveIntFromEnv(
  'REFRAIM_MAX_CONCURRENT_EXPORTS_PER_USER',
  2,
);

export interface ConcurrencyVerdict {
  allowed: boolean;
  active: number;
  limit: number;
}

export const CONCURRENCY_MESSAGE =
  `You already have ${MAX_CONCURRENT_EXPORTS_PER_USER} exports running. Wait for one to finish and try again.`;

/**
 * Count what this user genuinely has in flight.
 *
 * The count is lease-aware, matching the reaper's definition of a live run, so
 * a job abandoned by a dead worker frees its slot rather than holding it
 * forever — the precise failure the reaper exists to clear.
 *
 * Fails open. This bounds contention between users, and denying a paid export
 * because one read failed is a worse outcome than briefly exceeding the cap.
 * Every downstream cost gate still applies.
 */
export async function checkExportConcurrency(userId: string): Promise<ConcurrencyVerdict> {
  const unlimited: ConcurrencyVerdict = {
    allowed: true,
    active: 0,
    limit: MAX_CONCURRENT_EXPORTS_PER_USER,
  };

  try {
    const { data, error } = await supabase.rpc('count_active_refraim_exports', {
      p_user_id: userId,
      p_legacy_stale_seconds: Math.floor(LEGACY_STALE_MS / 1000),
    });

    if (error) {
      console.error('[export-concurrency] Could not count active exports:', error);
      return unlimited;
    }

    const active = Number(data ?? 0);
    const safeActive = Number.isFinite(active) && active > 0 ? active : 0;

    return {
      allowed: safeActive < MAX_CONCURRENT_EXPORTS_PER_USER,
      active: safeActive,
      limit: MAX_CONCURRENT_EXPORTS_PER_USER,
    };
  } catch (err) {
    console.error('[export-concurrency] Active export count threw:', err);
    return unlimited;
  }
}
