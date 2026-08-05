/**
 * Periodic sweep that converges exports whose worker is gone.
 *
 * **What triggers it, and why a timer.** Listen drives its reaping from the
 * next `claim`, which is enough there because its worker loop claims once a
 * second. refrAIm has no queue and no worker loop — an export is dispatched
 * fire-and-forget by the request that created it — so "the next claim" here
 * means "the next time some user exports some video". That is the same
 * dependency on user action the defect is about: the last export of the day
 * would stay stuck until an unrelated one arrived. So this is a self-scheduling
 * timer, started once at boot, and it converges with nothing open anywhere.
 *
 * Running it on every replica is intended. The sweep takes no ownership; each
 * candidate is handed to the recovery cascade, which already serialises two
 * concurrent recoverers on a conditional job transition and the publication
 * fence, and whose Gateway replay is idempotent on request id.
 */

import { DatabaseService } from '../services/databaseService';
import { listStaleExports } from './exportLease';
import { recoverExportState } from './exportRecovery';

const numberFromEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SWEEP_INTERVAL_MS = numberFromEnv('REFRAIM_REAPER_INTERVAL_MS', 60_000);
const SWEEP_BATCH = numberFromEnv('REFRAIM_REAPER_BATCH', 25);

export interface ReaperHandle {
  stop: () => void;
}

/** Exported for tests; the scheduler below is the only production caller. */
export async function sweepStaleExports(batchSize = SWEEP_BATCH): Promise<number> {
  const stale = await listStaleExports(batchSize);
  let reaped = 0;

  for (const candidate of stale) {
    try {
      const video = await DatabaseService.getVideo(candidate.videoId);
      if (!video || video.user_id !== candidate.userId) continue;
      const result = await recoverExportState(candidate.userId, candidate.videoId, video);
      if (result.outcome !== 'reconciling') reaped++;
    } catch (error) {
      // One unrecoverable row must not stop the rest of the batch, and the
      // next sweep will find it again.
      console.error('[export-reaper] Could not converge job:', candidate.jobId, error);
    }
  }

  return reaped;
}

export function startExportReaper(): ReaperHandle | null {
  if (process.env.REFRAIM_ENABLE_EXPORT_REAPER === 'false') {
    console.warn('[export-reaper] Disabled; stuck exports will only converge on a client poll');
    return null;
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), delay);
    // Never let a pending sweep be the only thing keeping the process alive.
    timer.unref();
  };

  const tick = async () => {
    try {
      const reaped = await sweepStaleExports();
      if (reaped > 0) console.log(`[export-reaper] Converged ${reaped} stale export(s)`);
    } catch (error) {
      console.error('[export-reaper] Sweep failed:', error);
    } finally {
      schedule(SWEEP_INTERVAL_MS);
    }
  };

  console.log(`[export-reaper] Sweeping every ${Math.round(SWEEP_INTERVAL_MS / 1000)}s`);
  schedule(SWEEP_INTERVAL_MS);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
