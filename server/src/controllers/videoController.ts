import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'fs';
import { processVideoForPlatforms } from '../services/videoProcessingService';
import { StorageService } from '../services/storageService';
import { DatabaseService } from '../services/databaseService';
import { supabase } from '../config/supabase';
import {
  checkTokens,
  compensateTokens,
  deductTokens,
  recordCostEvent,
} from '../lib/gateway-tokens';
import { getQuotaState, reserveExport } from '../lib/quota';
import { resolveBillingPath } from '../lib/billing-path';

const VALID_PLATFORMS = [
  'instagram-story',
  'instagram-feed-square',
  'instagram-feed-portrait',
  'facebook-story',
  'facebook-feed',
  'tiktok',
  'youtube-main',
  'youtube-shorts',
] as const;

const RETRYABLE_FAILURE_MESSAGE =
  'This export did not complete. You were not charged. Please retry.';
const FAILED_EXPORT_MESSAGE =
  'This export did not complete. Please retry.';
const RECONCILING_MESSAGE =
  'We are restoring your token balance. Please wait before retrying.';
const GATEWAY_SETTLEMENT_STALE_MS = 60_000;
const PROCESSING_JOB_STALE_MS = 30 * 60_000;
const MISSING_JOB_CLAIM_STALE_MS = 5 * 60_000;

function getActiveJobId(video: { processing_metadata?: unknown } | null): string | null {
  if (!video?.processing_metadata || typeof video.processing_metadata !== 'object') return null;
  const value = (video.processing_metadata as { active_job_id?: unknown }).active_job_id;
  return typeof value === 'string' ? value : null;
}

function isTimestampStale(
  updatedAt: string | undefined,
  createdAt: string | undefined,
  thresholdMs: number,
): boolean {
  const timestamp = Date.parse(updatedAt ?? createdAt ?? '');
  return Number.isFinite(timestamp) && Date.now() - timestamp >= thresholdMs;
}

function hasSuccessfulOutput(video: { platform_outputs?: unknown } | null): boolean {
  if (!video?.platform_outputs || typeof video.platform_outputs !== 'object') return false;
  return Object.values(video.platform_outputs as Record<string, { status?: string }>)
    .some(output => output?.status === 'complete');
}

function isTerminalJobStatus(status: unknown): boolean {
  const normalized = String(status ?? '').toLowerCase();
  return normalized === 'completed'
    || normalized === 'complete'
    || normalized === 'failed'
    || normalized === 'failed_compensated'
    || normalized === 'error';
}

function isStaleNonSettlementJob(job: {
  status?: unknown;
  updated_at?: string;
  created_at?: string;
}): boolean {
  if (isTerminalJobStatus(job.status) || isStaleGatewaySettlement(job)) return false;
  return isTimestampStale(job.updated_at, job.created_at, PROCESSING_JOB_STALE_MS);
}

function isStaleGatewaySettlement(job: {
  status?: unknown;
  updated_at?: string;
  created_at?: string;
}): boolean {
  const status = String(job.status ?? '').toLowerCase();
  if (![
    'settling_gateway_tokens',
    'publishing_gateway_tokens',
    'compensation_pending_gateway_tokens',
  ].includes(status) && !status.startsWith('reconciling_gateway_tokens:')) {
    return false;
  }

  const timestamp = Date.parse(job.updated_at ?? job.created_at ?? '');
  return !Number.isFinite(timestamp)
    || Date.now() - timestamp >= GATEWAY_SETTLEMENT_STALE_MS;
}

async function reconcileGatewayCharge(
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

function sanitizePlatforms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of input) {
    if (typeof p !== 'string') continue;
    if (!(VALID_PLATFORMS as readonly string[]).includes(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function safeUnlink(filePath: string | undefined): void {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch((err) => {
    // ENOENT is fine; storage service may have already removed it.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[upload] Failed to clean up temp file:', filePath, err);
    }
  });
}

export const uploadVideo = async (req: Request, res: Response) => {
  console.log('Starting video upload process');
  const tempPath = req.file?.path;

  try {
    const user = (req as any).user;
    if (!user) {
      safeUnlink(tempPath);
      return res.status(401).json({ error: 'Unauthorized' });
    }
    console.log('User authenticated:', { id: user.id, email: user.email });

    if (!req.file) {
      console.error('No file in request');
      return res.status(400).json({ error: 'No video file provided' });
    }

    console.log('File received:', {
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype,
      path: req.file.path,
    });

    // Parse + validate platforms BEFORE uploading to storage to avoid wasting
    // bandwidth and leaving orphan objects behind on bad input.
    let rawPlatforms: unknown = [];
    try {
      rawPlatforms = req.body.platforms ? JSON.parse(req.body.platforms) : [];
    } catch (e) {
      console.warn('Failed to parse platforms:', e);
      safeUnlink(tempPath);
      return res.status(400).json({
        error: 'Invalid platforms format',
        details: e instanceof Error ? e.message : 'Unknown error',
      });
    }
    const platforms = sanitizePlatforms(rawPlatforms);
    if (Array.isArray(rawPlatforms) && rawPlatforms.length > 0 && platforms.length === 0) {
      safeUnlink(tempPath);
      return res.status(400).json({
        error: 'No valid platforms provided',
        allowed: VALID_PLATFORMS,
      });
    }

    console.log('Uploading to storage...');
    // StorageService.uploadVideo deletes the temp file on success. We still
    // schedule a safeUnlink on its failure paths below.
    const videoUrl = await StorageService.uploadVideo(req.file.path, req.file.originalname);
    console.log('Upload successful:', { url: videoUrl });

    console.log('Creating database record...');
    const video = await DatabaseService.createVideo({
      original_url: videoUrl,
      status: 'UPLOADED',
      user_id: user.id,
      platforms,
      ...(req.body.title && { title: req.body.title }),
      ...(req.body.description && { description: req.body.description }),
    });

    console.log('Video record created:', {
      id: video.id,
      url: video.original_url,
      platforms: video.platforms,
    });

    res.status(201).json(await StorageService.signVideoRecord(video));
  } catch (error) {
    safeUnlink(tempPath);
    console.error('Error in uploadVideo:', {
      error,
      file: req.file,
      user: (req as any).user,
    });

    // Don't leak storage / database error strings. Supabase errors include
    // bucket names, table names, and sometimes RLS policy hints; raw
    // filesystem/ffmpeg errors include local paths.
    if (error instanceof Error) {
      if (error.message.includes('storage')) {
        return res.status(500).json({ error: 'Storage error' });
      } else if (error.message.includes('database')) {
        return res.status(500).json({ error: 'Database error' });
      }
    }

    res.status(500).json({ error: 'Error uploading video' });
  }
};

export const getVideoById = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const video = await DatabaseService.getVideo(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(await StorageService.signVideoRecord(video));
  } catch (error) {
    console.error('Error in getVideoById:', error);
    res.status(500).json({ error: 'Error fetching video' });
  }
};

export const getVideoStatus = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    let video = await DatabaseService.getVideo(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // The active job id lives on the video claim. Prefer it over "latest" so
    // an orphan job created before a lost claim cannot impersonate the worker
    // that actually owns this video.
    const activeJobId = getActiveJobId(video);
    let job = activeJobId
      ? await DatabaseService.getProcessingJob(activeJobId)
      : await DatabaseService.getLatestProcessingJob(id, user.id);

    if (
      activeJobId
      && !job
      && String(video.status).toLowerCase() === 'processing'
      && isTimestampStale(video.updated_at, video.created_at, MISSING_JOB_CLAIM_STALE_MS)
    ) {
      const released = await DatabaseService.releaseVideoProcessing(
        id,
        user.id,
        activeJobId,
        { status: 'failed', platform_outputs: null } as any,
      );
      if (released) {
        job = {
          id: activeJobId,
          status: 'failed',
          progress: 100,
          error: FAILED_EXPORT_MESSAGE,
        } as any;
        video.status = 'ERROR';
        video.platform_outputs = undefined;
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
        job = await DatabaseService.getLatestProcessingJob(id, user.id);
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
          const reconciliation = await reconcileGatewayCharge(user.id, jobId);
          if (!reconciliation.success) {
            return res.json({
              status: 'processing',
              progress: 99,
              platforms: {},
              platformOutputs: {},
              jobId,
              reconciling: true,
              error: RECONCILING_MESSAGE,
            });
          }
          const updatedJob = await DatabaseService.updateProcessingJob(jobId, {
            status: 'failed_compensated',
            progress: 100,
            error: RETRYABLE_FAILURE_MESSAGE,
            updated_at: new Date().toISOString(),
          } as any);
          job = { ...job, ...updatedJob, id: jobId };
        } else {
          const fenced = await DatabaseService.fenceVideoPublication(id, user.id, jobId);
          if (!fenced) {
            // Publication won the row race. Never compensate a run whose output
            // may already be visible; re-read its durable result instead.
            video = await DatabaseService.getVideo(id);
            job = activeJobId
              ? await DatabaseService.getProcessingJob(jobId)
              : await DatabaseService.getLatestProcessingJob(id, user.id);
            if (!video) {
              return res.status(404).json({ error: 'Video not found' });
            }
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
            const reconciliation = await reconcileGatewayCharge(user.id, jobId);
            if (!reconciliation.success) {
              return res.json({
                status: 'processing',
                progress: 99,
                platforms: {},
                platformOutputs: {},
                jobId,
                reconciling: true,
                error: RECONCILING_MESSAGE,
              });
            }

            const released = await DatabaseService.releaseVideoProcessing(
              id,
              user.id,
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
              video = await DatabaseService.getVideo(id);
              job = await DatabaseService.getLatestProcessingJob(id, user.id);
              if (!video) {
                return res.status(404).json({ error: 'Video not found' });
              }
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
            id,
            user.id,
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
            video = await DatabaseService.getVideo(id);
            job = activeJobId
              ? await DatabaseService.getProcessingJob(jobId)
              : await DatabaseService.getLatestProcessingJob(id, user.id);
            if (!video) {
              return res.status(404).json({ error: 'Video not found' });
            }
          }
        }
      } else {
        job = activeJobId
          ? await DatabaseService.getProcessingJob(jobId)
          : await DatabaseService.getLatestProcessingJob(id, user.id);
      }
    }

    const platformOutputs = video.platform_outputs || {};
    const jobStatus = String(job?.status ?? '').toLowerCase();
    const videoStatus = String(video.status).toLowerCase();
    const normalizedStatus = job && !isTerminalJobStatus(jobStatus)
      ? 'processing'
      : jobStatus.startsWith('failed') || jobStatus === 'error'
        ? 'failed'
        : videoStatus === 'error'
          ? 'failed'
          : videoStatus;
    const aggregateProgress =
      isTerminalJobStatus(jobStatus)
        || videoStatus === 'completed'
        || videoStatus === 'complete'
        || videoStatus === 'failed'
        || videoStatus === 'error'
        ? 100
        : (job?.progress ?? 0);

    // Mirror each platform output under the `platforms` key the client
    // expects. For completed platforms, surface both the original url
    // and a `progress: 100` so the UI's % reduce math lines up.
    const platforms: Record<string, {
      status: string;
      progress: number;
      url?: string;
      error?: string;
    }> = {};
    for (const [platform, raw] of Object.entries(platformOutputs as Record<string, {
      status?: string;
      url?: string;
      error?: string;
    }>)) {
      const done = raw?.status === 'complete';
      const errored = raw?.status === 'error';
      platforms[platform] = {
        status: raw?.status ?? 'processing',
        progress: done || errored ? 100 : aggregateProgress,
        url: raw?.url ? (await StorageService.getSignedUrl(raw.url)) ?? raw.url : raw?.url,
        error: raw?.error,
      };
    }

    const signedRecord = await StorageService.signVideoRecord({ platform_outputs: platformOutputs });
    res.json({
      status: normalizedStatus,
      progress: aggregateProgress,
      platforms,
      platformOutputs: signedRecord.platform_outputs, // kept for any external callers on the old shape
      jobId: job?.id ?? activeJobId ?? undefined,
      error: job?.error ?? undefined,
      balanceChanged: jobStatus === 'failed_compensated',
    });
  } catch (error) {
    console.error('Error in getVideoStatus:', error);
    res.status(500).json({ error: 'Error fetching video status' });
  }
};

export const processVideo = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const rawPlatforms = req.body?.platforms;

    if (!rawPlatforms || !Array.isArray(rawPlatforms)) {
      return res.status(400).json({ error: 'Invalid platforms specified' });
    }

    const platforms = sanitizePlatforms(rawPlatforms);
    if (platforms.length === 0) {
      return res.status(400).json({
        error: 'No valid platforms provided',
        allowed: VALID_PLATFORMS,
      });
    }

    const video = await DatabaseService.getVideo(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Resolve exactly ONE billing path for this export (UXA F-010):
    // remaining plan allowance (free or paid) is consumed first and costs
    // no tokens; an exhausted free allowance falls back to Gateway tokens;
    // otherwise the export is blocked.
    const quotaState = await getQuotaState(user.id);
    const serviceKeyConfigured = Boolean(process.env.AIDEN_SERVICE_KEY);
    const allowanceRemaining = Number.isFinite(quotaState.remaining)
      ? (quotaState.remaining as number)
      : Number.POSITIVE_INFINITY;
    let billingPath = resolveBillingPath(
      quotaState.plan,
      allowanceRemaining,
      serviceKeyConfigured,
    );

    if (billingPath === 'blocked') {
      return res.status(402).json({
        error: 'Monthly export limit reached',
        message: 'You have used your export allowance for this month. Upgrade your plan to keep exporting.',
        upgradeUrl: '/#/billing',
      });
    }

    // Persist the request id before taking the video lease or reserving plan
    // allowance. A crash can leave an orphan job, but never an untraceable
    // active claim or a consumed allowance with no durable job identity.
    const requestId = randomUUID();
    let processingJob = await DatabaseService.createProcessingJob({
      id: requestId,
      video_id: id,
      platforms,
      status: `processing_${billingPath}`,
      progress: 0,
      error: null,
      user_id: user.id,
    } as any);

    let claimed: boolean;
    try {
      claimed = await DatabaseService.claimVideoForProcessing(id, user.id, requestId);
    } catch (error) {
      await DatabaseService.deleteProcessingJob(requestId, user.id);
      throw error;
    }
    if (!claimed) {
      await DatabaseService.deleteProcessingJob(requestId, user.id);
      const currentVideo = await DatabaseService.getVideo(id);
      const currentActiveJobId = getActiveJobId(currentVideo);
      const activeJob = currentActiveJobId
        ? await DatabaseService.getProcessingJob(currentActiveJobId)
        : await DatabaseService.getLatestProcessingJob(id, user.id);
      if (activeJob && !isTerminalJobStatus(activeJob.status)) {
        return res.status(202).json({ ...activeJob, active: true });
      }
      return res.status(409).json({
        error: 'This video already has processing in progress. Please wait and retry.',
        retryable: true,
      });
    }

    const restoreClaim = () => DatabaseService.releaseVideoProcessing(
      id,
      user.id,
      requestId,
      {
        status: video.status,
        platform_outputs: video.platform_outputs ?? null,
        processing_metadata: video.processing_metadata ?? null,
      } as any,
    );

    const abandonSetup = async () => {
      await restoreClaim();
      await DatabaseService.deleteProcessingJob(requestId, user.id);
    };

    let reserved = quotaState;
    try {
      if (billingPath === 'plan_quota') {
        const afterReserve = await reserveExport(user.id);
        if (afterReserve) {
          reserved = afterReserve;
        } else {
          // Lost a race for the last allowance slot; re-resolve with 0 left.
          billingPath = resolveBillingPath(quotaState.plan, 0, serviceKeyConfigured);
          if (billingPath !== 'blocked') {
            const updatedJob = await DatabaseService.updateProcessingJob(requestId, {
              status: `processing_${billingPath}`,
              updated_at: new Date().toISOString(),
            } as any);
            processingJob = { ...processingJob, ...updatedJob, id: requestId };
          }
        }
      }
    } catch (error) {
      await abandonSetup();
      throw error;
    }

    if (billingPath === 'blocked') {
      await abandonSetup();
      return res.status(402).json({
        error: 'Monthly export limit reached',
        message: 'You have used your export allowance for this month. Upgrade your plan to keep exporting.',
        upgradeUrl: '/#/billing',
      });
    }

    const chargeGatewayTokens = billingPath === 'gateway_tokens';
    if (chargeGatewayTokens) {
      const tokenCheck = await checkTokens(user.id, 'refraim', 'video_export');
      if (!tokenCheck.allowed) {
        await abandonSetup();
        return res.status(402).json({
          error: 'Insufficient tokens',
          message: 'Your free export allowance is used and your token balance is too low for this export.',
          required: tokenCheck.required,
          balance: tokenCheck.balance,
          upgradeUrl: '/#/billing',
        });
      }
    }

    const processingStartedAt = Date.now();
    let deductionTransactionId: string | undefined;
    let gatewaySettlementStarted = false;

    // Start processing asynchronously; deduct tokens only when at least one
    // output succeeds, and before that output becomes visible to the client.
    // We do NOT refund the Stripe plan quota on failure. The work was
    // attempted and the FFmpeg cost was paid. If the failure is a hard
    // infra error (quota-gate followed by a server crash), the user can
    // retry within the month cap.
    processVideoForPlatforms(video, platforms, {
      jobId: processingJob.id,
      billingPath,
      beforePublish: async (outcome) => {
        const processingStatus = `processing_${billingPath}`;
        let expectedPublishingStatus = processingStatus;
        if (process.env.AIDEN_SERVICE_KEY) {
          const computeSeconds = (Date.now() - processingStartedAt) / 1000;
          await recordCostEvent({
            userId: user.id,
            requestId,
            idempotencyKey: outcome.successfulOutputs > 0
              ? `railway:${requestId}`
              : `railway:${requestId}:failed`,
            providerTaskId: processingJob.id,
            status: outcome.successfulOutputs > 0 ? 'unallocated' : 'failed',
            computeSeconds,
            metadata: {
              reason: outcome.successfulOutputs > 0
                ? 'railway_resource_usage_requires_project_cost_allocation'
                : 'all_video_outputs_failed',
              platformCount: platforms.length,
              billingPath: chargeGatewayTokens ? 'gateway_tokens' : 'stripe_plan',
            },
          });
          if (chargeGatewayTokens && outcome.successfulOutputs > 0) {
            const settlingJob = await DatabaseService.transitionProcessingJob(
              processingJob.id,
              [processingStatus],
              {
                status: 'settling_gateway_tokens',
                progress: 95,
                updated_at: new Date().toISOString(),
              } as any,
            );
            if (!settlingJob) {
              throw new Error('Processing billing phase is no longer active');
            }
            gatewaySettlementStarted = true;
            expectedPublishingStatus = 'settling_gateway_tokens';
            const deduction = await deductTokens(
              user.id,
              'refraim',
              'video_export',
              requestId,
            );
            if (!deduction.success) {
              throw new Error('Gateway token settlement failed');
            }
            deductionTransactionId = deduction.transactionId;
          }
        }
        const publishingJob = await DatabaseService.transitionProcessingJob(
          processingJob.id,
          [expectedPublishingStatus],
          {
            status: outcome.successfulOutputs > 0
              ? `publishing_${billingPath}`
              : 'publishing_no_charge',
            progress: 98,
            updated_at: new Date().toISOString(),
          } as any,
        );
        if (!publishingJob) {
          throw new Error('Processing publication phase is no longer active');
        }
      },
    })
      .catch(async (error) => {
        console.error(error);
        let currentVideo;
        try {
          currentVideo = await DatabaseService.getVideo(id);
        } catch (readError) {
          // Leave the durable settling/publishing state intact. A later status
          // request can safely reconcile it using this job id.
          console.error('Could not inspect failed processing publication:', readError);
          return;
        }

        if (hasSuccessfulOutput(currentVideo)) {
          let currentJob;
          try {
            currentJob = await DatabaseService.getProcessingJob(processingJob.id);
          } catch (jobReadError) {
            console.error('Could not verify failed publication ownership:', jobReadError);
            return;
          }
          if (currentJob?.id === processingJob.id) {
            await DatabaseService.updateProcessingJob(processingJob.id, {
              status: String(currentVideo?.status).toLowerCase() === 'failed'
                ? 'failed'
                : 'completed',
              progress: 100,
              updated_at: new Date().toISOString(),
            } as any);
            return;
          }
        }

        let compensated = false;
        if (chargeGatewayTokens && gatewaySettlementStarted) {
          const fenced = await DatabaseService.fenceVideoPublication(
            id,
            user.id,
            processingJob.id,
          );
          if (!fenced) {
            // Publication won the video-row race. Do not refund a delivered
            // output. The next status read will finalize its job state.
            const publishedVideo = await DatabaseService.getVideo(id);
            if (hasSuccessfulOutput(publishedVideo)) {
              await DatabaseService.updateProcessingJob(processingJob.id, {
                status: String(publishedVideo?.status).toLowerCase() === 'failed'
                  ? 'failed'
                  : 'completed',
                progress: 100,
                error: null,
                updated_at: new Date().toISOString(),
              } as any);
            }
            return;
          }
          await DatabaseService.updateProcessingJob(processingJob.id, {
            status: 'compensation_pending_gateway_tokens',
            progress: 99,
            error: 'We are restoring your token balance. Please wait before retrying.',
            updated_at: new Date().toISOString(),
          } as any);
          const reconciliation = await reconcileGatewayCharge(
            user.id,
            requestId,
            deductionTransactionId,
          );
          if (!reconciliation.success) {
            console.error('Gateway compensation remains pending:', reconciliation.error);
            return;
          }
          compensated = true;
        }

        const released = await DatabaseService.releaseVideoProcessing(
          id,
          user.id,
          processingJob.id,
          {
            status: 'failed',
            platform_outputs: null,
          } as any,
        );
        if (!released) {
          // Keep the durable job nonterminal. A later status request can
          // inspect whether publication or another recovery owner won.
          return;
        }
        await DatabaseService.updateProcessingJob(processingJob.id, {
          status: compensated ? 'failed_compensated' : 'failed',
          progress: 100,
          error: chargeGatewayTokens
            ? RETRYABLE_FAILURE_MESSAGE
            : FAILED_EXPORT_MESSAGE,
          updated_at: new Date().toISOString(),
        } as any);
        if (process.env.AIDEN_SERVICE_KEY) {
          await recordCostEvent({
            userId: user.id,
            requestId,
            idempotencyKey: `railway:${requestId}:failed`,
            providerTaskId: processingJob.id,
            status: 'failed',
            computeSeconds: (Date.now() - processingStartedAt) / 1000,
            metadata: {
              reason: 'video_processing_failed',
              platformCount: platforms.length,
              billingPath: chargeGatewayTokens ? 'gateway_tokens' : 'stripe_plan',
            },
          });
        }
      });

    res.json({
      ...processingJob,
      quota: {
        used: reserved.used,
        limit: reserved.limit,
        remaining: Number.isFinite(reserved.remaining) ? reserved.remaining : null,
      },
      billing: {
        path: billingPath,
        tokenCost: chargeGatewayTokens ? 2 : 0,
      },
    });
  } catch (error) {
    console.error('Error in processVideo:', error);
    res.status(500).json({ error: 'Error starting video processing' });
  }
};

export const getUserVideos = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const videos = await DatabaseService.getUserVideos(user.id);
    res.json(await Promise.all(videos.map((v: any) => StorageService.signVideoRecord(v))));
  } catch (error) {
    console.error('Error in getUserVideos:', error);
    res.status(500).json({ error: 'Error fetching user videos' });
  }
};

export const deleteVideo = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const video = await DatabaseService.getVideo(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const latestJob = await DatabaseService.getLatestProcessingJob(id, user.id);
    const videoStatus = String(video.status).toLowerCase();
    const activeJobId = (video.processing_metadata as { active_job_id?: unknown } | null)
      ?.active_job_id;
    if (
      videoStatus === 'processing'
      || typeof activeJobId === 'string'
      || (latestJob && !isTerminalJobStatus(latestJob.status))
    ) {
      return res.status(409).json({
        error: 'This video is still processing or restoring billing. Wait for it to finish before deleting.',
        retryable: true,
      });
    }

    // Win the final database race before removing storage. A processing claim
    // that starts after the reads above changes videos.status to processing,
    // causing this conditional delete to return false without losing data.
    const deleted = await DatabaseService.deleteVideoIfIdle(id, user.id);
    if (!deleted) {
      return res.status(409).json({
        error: 'This video started processing. Wait for it to finish before deleting.',
        retryable: true,
      });
    }

    // The database row is gone, so no worker can establish a new paid claim.
    // Storage cleanup can now run without racing a new export.
    await StorageService.deleteVideo(video.original_url);
    if (video.platform_outputs) {
      const outputs = Object.values(video.platform_outputs) as Array<{ url?: string }>;
      for (const platform of outputs) {
        if (platform?.url) {
          await StorageService.deleteVideo(platform.url);
        }
      }
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error in deleteVideo:', error);
    res.status(500).json({ error: 'Error deleting video' });
  }
};

export const getVideoOutput = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { id, platform } = req.params;

    // Validate platform
    const validPlatforms = ['instagram-story', 'instagram-feed-square', 'instagram-feed-portrait', 'facebook-story', 'facebook-feed', 'tiktok', 'youtube-main', 'youtube-shorts'];
    if (!platform || !validPlatforms.includes(platform)) {
      return res.status(400).json({ error: 'Invalid platform', details: `Valid platforms: ${validPlatforms.join(', ')}` });
    }

    // Get video, verify ownership
    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Check platform_outputs has this platform
    const outputs = video.platform_outputs;
    if (!outputs || !outputs[platform] || !outputs[platform].url) {
      return res.status(404).json({ error: `No output found for platform: ${platform}` });
    }

    const signedUrl = await StorageService.getSignedUrl(outputs[platform].url);
    return res.json({
      url: signedUrl ?? outputs[platform].url,
      platform,
      format: outputs[platform].format || platform,
      file_size: outputs[platform].file_size || 0,
    });
  } catch (error) {
    console.error('Error getting video output:', error);
    return res.status(500).json({ error: 'Failed to get video output' });
  }
};
