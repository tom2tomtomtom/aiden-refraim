/**
 * Leases for in-flight exports.
 *
 * refrAIm already fences a running export with `processing_metadata.active_job_id`
 * and conditional job-status transitions, which is the equivalent of Listen's
 * `run_token`. What it lacked was the other half of that pattern: a lease the
 * owner must keep renewing, so "this worker is gone" is a fact rather than an
 * inference from how long ago progress last moved.
 *
 * That inference was also wrong in one direction. A single platform render is
 * allowed up to `MAX_RENDER_TIMEOUT_MS` (1 h) and writes no progress while it
 * runs, but a job was treated as stale after 30 minutes without an update — so
 * a slow but perfectly healthy render could be declared dead, refunded and
 * failed underneath itself. A heartbeat closes that in both directions.
 */

import { supabase } from '../config/supabase';

const positiveNumberFromEnv = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const EXPORT_LEASE_SECONDS = positiveNumberFromEnv(
  'REFRAIM_EXPORT_LEASE_SECONDS',
  120,
);
/** Three heartbeats fit inside one lease, so two may be lost without a false reap. */
export const EXPORT_HEARTBEAT_MS = positiveNumberFromEnv(
  'REFRAIM_EXPORT_HEARTBEAT_MS',
  (EXPORT_LEASE_SECONDS / 4) * 1000,
);

/** Jobs that predate the lease column keep the previous staleness rule. */
export const LEGACY_STALE_MS = 30 * 60_000;

export interface StaleExport {
  jobId: string;
  videoId: string;
  userId: string;
}

/** Lease stamped at job creation, so a crash during setup is reaped too. */
export const initialLeaseExpiry = (): string =>
  new Date(Date.now() + EXPORT_LEASE_SECONDS * 1000).toISOString();

/** Returns false once the job is terminal or gone: the caller should stop. */
export async function heartbeatExport(jobId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('heartbeat_refraim_export', {
    p_job_id: jobId,
    p_user_id: userId,
    p_lease_seconds: Math.round(EXPORT_LEASE_SECONDS),
  });
  if (error) throw error;
  return data === true;
}

/**
 * Renew the lease while this process owns the run.
 *
 * `maxLifetimeMs` is not a nicety. A heartbeat that can outlive its run would
 * renew the lease forever, and the job it belongs to would become the one
 * thing the reaper can never reap — which is exactly the hang class the reaper
 * exists to catch. Renewal therefore stops on its own once the run has
 * exceeded every render ceiling it was allowed, and the lease lapses from
 * there. The RPC's own `false` (job terminal or gone) stops it too.
 *
 * The timer is unref'd so a pending renewal never keeps Node alive by itself.
 */
export function startExportHeartbeat(
  jobId: string,
  userId: string,
  maxLifetimeMs: number,
): () => void {
  const deadline = Date.now() + maxLifetimeMs;
  const timer = setInterval(() => {
    if (Date.now() >= deadline) {
      console.warn('[export-lease] Run outlived its render budget; releasing lease:', jobId);
      clearInterval(timer);
      return;
    }
    void heartbeatExport(jobId, userId)
      .then((held) => {
        if (!held) clearInterval(timer);
      })
      .catch((error) => {
        console.error('[export-lease] Heartbeat failed:', jobId, error);
      });
  }, EXPORT_HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export async function listStaleExports(limit: number): Promise<StaleExport[]> {
  const { data, error } = await supabase.rpc('list_stale_refraim_exports', {
    p_limit: limit,
    p_legacy_stale_seconds: Math.round(LEGACY_STALE_MS / 1000),
  });
  if (error) throw error;
  return ((data ?? []) as Array<{ job_id: string; video_id: string; user_id: string }>)
    .map(row => ({ jobId: row.job_id, videoId: row.video_id, userId: row.user_id }));
}

/**
 * A recorded lease is authoritative in both directions. Only a job with no
 * lease at all falls back to judging staleness by when progress last moved.
 */
export function isLeaseLapsed(
  job: { lease_expires_at?: string | null },
  fallback: () => boolean,
): boolean {
  const expiry = Date.parse(job.lease_expires_at ?? '');
  if (Number.isFinite(expiry)) return expiry < Date.now();
  return fallback();
}
