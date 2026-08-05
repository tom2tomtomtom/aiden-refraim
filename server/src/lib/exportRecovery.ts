/**
 * Convergence for an export whose worker did not finish it.
 *
 * This logic used to live inside the status controller, which meant it only
 * ever ran while a browser tab was polling. It is unchanged in substance —
 * every ownership fence, compensation order and idempotency guarantee is the
 * one that was already there — but it is now callable without a request, so
 * the reaper and the delete path can converge a job too.
 */

import { randomUUID } from 'node:crypto';
import { Video } from '../types/database';
import { DatabaseService } from '../services/databaseService';
import { compensateTokens, deductTokens } from './gateway-tokens';
import { recoverPlanQuotaExport } from './quota';
import { isLeaseLapsed, LEGACY_STALE_MS } from './exportLease';

export const RETRYABLE_FAILURE_MESSAGE =
  'This export did not complete. You were not charged. Please retry.';
export const FAILED_EXPORT_MESSAGE =
  'This export did not complete. Please retry.';
export const RECONCILING_MESSAGE =
  'We are restoring your token balance. Please wait before retrying.';
export const GATEWAY_SETTLEMENT_STALE_MS = 60_000;
export const PROCESSING_JOB_STALE_MS = LEGACY_STALE_MS;
export const MISSING_JOB_CLAIM_STALE_MS = 5 * 60_000;

export function getActiveJobId(video: { processing_metadata?: unknown } | null): string | null {
  if (!video?.processing_metadata || typeof video.processing_metadata !== 'object') return null;
  const value = (video.processing_metadata as { active_job_id?: unknown }).active_job_id;
  return typeof value === 'string' ? value : null;
}

export function isTimestampStale(
  updatedAt: string | undefined,
  createdAt: string | undefined,
  thresholdMs: number,
): boolean {
  const timestamp = Date.parse(updatedAt ?? createdAt ?? '');
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= thresholdMs;
}

export function hasSuccessfulOutput(video: { platform_outputs?: unknown } | null): boolean {
  if (!video?.platform_outputs || typeof video.platform_outputs !== 'object') return false;
  return Object.values(video.platform_outputs as Record<string, { status?: string }>)
    .some(output => output?.status === 'complete');
}

export function isTerminalJobStatus(status: unknown): boolean {
  const normalized = String(status ?? '').toLowerCase();
  return normalized === 'completed'
    || normalized === 'complete'
    || normalized === 'failed'
    || normalized === 'failed_compensated'
    || normalized === 'failed_allowance_refunded'
    || normalized === 'error';
}

interface JobTiming {
  updated_at?: string;
  created_at?: string;
  lease_expires_at?: string | null;
}

/** A live lease outranks the timestamp heuristic; see lib/exportLease. */
function isJobStale(job: JobTiming, thresholdMs: number): boolean {
  return isLeaseLapsed(job, () => isTimestampStale(job.updated_at, job.created_at, thresholdMs));
}

export function isPlanQuotaRecoveryStatus(status: unknown): boolean {
  const normalized = String(status ?? '').toLowerCase();
  return normalized === 'reserving_plan_quota'
    || normalized === 'processing_plan_quota'
    || normalized === 'publishing_plan_quota'
    || normalized === 'publishing_no_charge_plan_quota';
}

export function isPlanQuotaRecoveryReady(job: JobTiming & { status?: unknown }): boolean {
  return String(job.status ?? '').toLowerCase() === 'publishing_no_charge_plan_quota'
    || isJobStale(job, PROCESSING_JOB_STALE_MS);
}

export function isLegacyAmbiguousQuotaStatus(status: unknown): boolean {
  const normalized = String(status ?? '').toLowerCase();
  return normalized === 'pending'
    || normalized === 'running'
    || normalized === 'processing'
    || normalized === 'publishing_no_charge';
}

export function isStaleNonSettlementJob(job: JobTiming & { status?: unknown }): boolean {
  if (isTerminalJobStatus(job.status) || isStaleGatewaySettlement(job)) return false;
  return isJobStale(job, PROCESSING_JOB_STALE_MS);
}

export function isStaleGatewaySettlement(job: JobTiming & { status?: unknown }): boolean {
  const status = String(job.status ?? '').toLowerCase();
  if (![
    'settling_gateway_tokens',
    'publishing_gateway_tokens',
    'compensation_pending_gateway_tokens',
  ].includes(status) && !status.startsWith('reconciling_gateway_tokens:')) {
    return false;
  }

  return isJobStale(job, GATEWAY_SETTLEMENT_STALE_MS);
}

export async function reconcileGatewayCharge(
  userId: string,
  requestId: string,
  knownTransactionId?: string,
) {
  let transactionId = knownTransactionId;
  if (!transactionId) {
    // Replaying the request id is the only safe way to resolve an ambiguous
    // network outcome. Gateway's unique (user, request_id) key guarantees
    // this creates at most one deduction or returns the existing one.
    const deduction = await deductTokens(
      userId,
      'refraim',
      'video_export',
      requestId,
    );
    if (!deduction.success) {
      if (deduction.error === 'insufficient_tokens') {
        return { success: true, noDeduction: true };
      }
      return { success: false, error: deduction.error };
    }
    transactionId = deduction.transactionId;
  }

  return transactionId
    ? compensateTokens(
      userId,
      'refraim',
      'video_export',
      requestId,
      transactionId,
    )
    : compensateTokens(userId, 'refraim', 'video_export', requestId);
}

type AnyVideo = any;
type AnyJob = any;

export type ExportRecoveryResult =
  | { outcome: 'resolved'; video: Video; job: AnyJob; activeJobId: string | null }
  | { outcome: 'video-missing' }
  | { outcome: 'reconciling'; jobId: string };

/**
 * Bring one export's durable state up to date and return what it converged to.
 * Safe to call concurrently with itself and with a live worker: every branch
 * either wins a conditional transition or re-reads whoever did.
 */
export async function recoverExportState(
  userId: string,
  videoId: string,
  initialVideo: AnyVideo,
): Promise<ExportRecoveryResult> {
  let video = initialVideo;

  // The active job id lives on the video claim. Prefer it over "latest" so
  // an orphan job created before a lost claim cannot impersonate the worker
  // that actually owns this video.
  const activeJobId = getActiveJobId(video);
  let job = activeJobId
    ? await DatabaseService.getProcessingJob(activeJobId)
    : await DatabaseService.getLatestProcessingJob(videoId, userId);

  if (
    activeJobId
    && !job
    && String(video.status).toLowerCase() === 'processing'
    && isTimestampStale(video.updated_at, video.created_at, MISSING_JOB_CLAIM_STALE_MS)
  ) {
    const recovery = await recoverPlanQuotaExport(userId, videoId, activeJobId, true);
    if (recovery.recovered) {
      video = await DatabaseService.getVideo(videoId);
      job = await DatabaseService.getProcessingJob(activeJobId);
      if (!video) return { outcome: 'video-missing' };
    }
  } else if (job && hasSuccessfulOutput(video) && !isTerminalJobStatus(job.status)) {
    const jobId = job.id;
    const recoveredStatus = String(video.status).toLowerCase() === 'failed'
      ? 'failed'
      : 'completed';
    const updatedJob = await DatabaseService.updateProcessingJob(jobId, {
      status: recoveredStatus,
      progress: 100,
      updated_at: new Date().toISOString(),
    } as any);
    job = { ...job, ...updatedJob, id: jobId };
  } else if (
    job
    && isPlanQuotaRecoveryStatus(job.status)
    && isPlanQuotaRecoveryReady(job)
  ) {
    const jobId = job.id;
    const recovery = await recoverPlanQuotaExport(userId, videoId, jobId, false);
    if (recovery.recovered) {
      video = await DatabaseService.getVideo(videoId);
      job = await DatabaseService.getProcessingJob(jobId);
      if (!video) return { outcome: 'video-missing' };
    }
  } else if (
    job
    && isLegacyAmbiguousQuotaStatus(job.status)
    && isJobStale(job, PROCESSING_JOB_STALE_MS)
  ) {
    const jobId = job.id;
    const recovery = await recoverPlanQuotaExport(userId, videoId, jobId, true);
    if (recovery.recovered) {
      video = await DatabaseService.getVideo(videoId);
      job = await DatabaseService.getProcessingJob(jobId);
      if (!video) return { outcome: 'video-missing' };
    }
  } else if (job && isStaleGatewaySettlement(job)) {
    const jobId = job.id;
    const recoveryStatus = `reconciling_gateway_tokens:${randomUUID()}`;
    const recoveryJob = await DatabaseService.transitionProcessingJob(
      jobId,
      [String(job.status)],
      {
        status: recoveryStatus,
        progress: 99,
        error: RECONCILING_MESSAGE,
        updated_at: new Date().toISOString(),
      } as any,
    );
    if (!recoveryJob) {
      // Another poll or the worker changed phase first. Only that owner may
      // reconcile; this request reports the newly durable state.
      job = await DatabaseService.getLatestProcessingJob(videoId, userId);
    } else {
      job = { ...job, ...recoveryJob, id: jobId };
      const videoStatus = String(video.status).toLowerCase();
      const videoAlreadyReleased = !activeJobId
        && (videoStatus === 'failed' || videoStatus === 'error')
        && !hasSuccessfulOutput(video);

      if (videoAlreadyReleased) {
        // Compensation and release may have committed just before the
        // process died. Gateway reconciliation is idempotent, so finish the
        // durable job marker without trying to reacquire a cleared fence.
        const reconciliation = await reconcileGatewayCharge(userId, jobId);
        if (!reconciliation.success) return { outcome: 'reconciling', jobId };
        const updatedJob = await DatabaseService.updateProcessingJob(jobId, {
          status: 'failed_compensated',
          progress: 100,
          error: RETRYABLE_FAILURE_MESSAGE,
          updated_at: new Date().toISOString(),
        } as any);
        job = { ...job, ...updatedJob, id: jobId };
      } else {
        const fenced = await DatabaseService.fenceVideoPublication(videoId, userId, jobId);
        if (!fenced) {
          // Publication won the row race. Never compensate a run whose output
          // may already be visible; re-read its durable result instead.
          video = await DatabaseService.getVideo(videoId);
          job = activeJobId
            ? await DatabaseService.getProcessingJob(jobId)
            : await DatabaseService.getLatestProcessingJob(videoId, userId);
          if (!video) return { outcome: 'video-missing' };
          if (hasSuccessfulOutput(video) && job && !isTerminalJobStatus(job.status)) {
            const recoveredStatus = String(video.status).toLowerCase() === 'failed'
              ? 'failed'
              : 'completed';
            const updatedJob = await DatabaseService.updateProcessingJob(jobId, {
              status: recoveredStatus,
              progress: 100,
              error: null,
              updated_at: new Date().toISOString(),
            } as any);
            job = { ...job, ...updatedJob, id: jobId };
          }
        } else {
          const reconciliation = await reconcileGatewayCharge(userId, jobId);
          if (!reconciliation.success) return { outcome: 'reconciling', jobId };

          const released = await DatabaseService.releaseVideoProcessing(
            videoId,
            userId,
            jobId,
            {
              status: 'failed',
              platform_outputs: null,
            } as any,
          );
          if (released) {
            const updatedJob = await DatabaseService.updateProcessingJob(jobId, {
              status: 'failed_compensated',
              progress: 100,
              error: RETRYABLE_FAILURE_MESSAGE,
              updated_at: new Date().toISOString(),
            } as any);
            job = { ...job, ...updatedJob, id: jobId };
            video.status = 'ERROR';
            video.platform_outputs = undefined;
          } else {
            // A live worker crossed the publication boundary before recovery
            // won the ownership predicate. Re-read its result.
            video = await DatabaseService.getVideo(videoId);
            job = await DatabaseService.getLatestProcessingJob(videoId, userId);
            if (!video) return { outcome: 'video-missing' };
          }
        }
      }
    }
  } else if (job && isStaleNonSettlementJob(job)) {
    const jobId = job.id;
    const recoveryStatus = `recovering_no_charge:${randomUUID()}`;
    const recoveryJob = await DatabaseService.transitionProcessingJob(
      jobId,
      [String(job.status)],
      {
        status: recoveryStatus,
        progress: 99,
        error: FAILED_EXPORT_MESSAGE,
        updated_at: new Date().toISOString(),
      } as any,
    );
    if (recoveryJob) {
      const videoStatus = String(video.status).toLowerCase();
      const orphanedBeforeClaim = !activeJobId && videoStatus !== 'processing';
      if (orphanedBeforeClaim) {
        const updatedJob = await DatabaseService.updateProcessingJob(jobId, {
          status: 'failed',
          progress: 100,
          error: FAILED_EXPORT_MESSAGE,
          updated_at: new Date().toISOString(),
        } as any);
        job = { ...job, ...updatedJob, id: jobId };
      } else {
        const released = await DatabaseService.releaseVideoProcessing(
          videoId,
          userId,
          jobId,
          { status: 'failed', platform_outputs: null } as any,
        );
        if (released) {
          const updatedJob = await DatabaseService.updateProcessingJob(jobId, {
            status: 'failed',
            progress: 100,
            error: FAILED_EXPORT_MESSAGE,
            updated_at: new Date().toISOString(),
          } as any);
          job = { ...job, ...updatedJob, id: jobId };
          video.status = 'ERROR';
          video.platform_outputs = undefined;
        } else {
          video = await DatabaseService.getVideo(videoId);
          job = activeJobId
            ? await DatabaseService.getProcessingJob(jobId)
            : await DatabaseService.getLatestProcessingJob(videoId, userId);
          if (!video) return { outcome: 'video-missing' };
        }
      }
    } else {
      job = activeJobId
        ? await DatabaseService.getProcessingJob(jobId)
        : await DatabaseService.getLatestProcessingJob(videoId, userId);
    }
  }

  // Every reassignment above is immediately null-checked, so the video is
  // present on all paths that reach here.
  return { outcome: 'resolved', video: video as Video, job, activeJobId };
}
