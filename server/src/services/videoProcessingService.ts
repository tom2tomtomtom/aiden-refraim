import { supabase } from '../config/supabase';
import path from 'path';
import fs from 'fs';
import { analyzeVideo } from './videoAnalysisService';
import { StorageService, PIPELINE_SIGNED_URL_TTL_SECONDS } from './storageService';
import { OUTPUT_FORMATS, OutputFormat } from '../config/outputFormats';
import { FFmpegService } from './ffmpegService';
import { defaultConfig, VideoProcessingConfig } from '../config/videoProcessing';
import { findSourceLimitViolation, renderTimeoutMs } from '../config/mediaLimits';
import { startExportHeartbeat } from '../lib/exportLease';

interface Video {
  id: string;
  user_id: string;
  original_url: string;
  processed_url?: string | null;
  // Accept both the older lowercase lifecycle strings used inside this
  // service and the canonical uppercase ones stored in Supabase so the
  // controller can hand us a canonical Video row without a cast.
  status:
    | 'pending' | 'processing' | 'completed' | 'failed'
    | 'UPLOADED' | 'PROCESSING' | 'COMPLETE' | 'ERROR';
  error?: string | null;
  platforms: string[];
  // DB column is JSONB. Different code paths project it into different
  // shapes (`VideoAnalysis` locally, `ProcessingMetadata` in types/database).
  // Keep the field permissive and narrow at the read site.
  processing_metadata?: VideoAnalysis | object;
  platform_outputs?: Record<string, {
    url: string;
    format: string;
    width?: number;
    height?: number;
    status: 'complete' | 'error';
    error?: string;
  }>;
}

export interface VideoProcessor {
  process(
    video: Video,
    platforms: string[],
    context: ProcessingRunContext,
  ): Promise<ProcessingOutcome>;
}

export interface ProcessingOutcome {
  successfulOutputs: number;
  failedOutputs: number;
}

export type BeforePublish = (outcome: ProcessingOutcome) => Promise<void>;
export type AfterPublish = (outcome: ProcessingOutcome) => Promise<boolean>;

export interface ProcessingRunContext {
  jobId: string;
  billingPath: 'plan_quota' | 'gateway_tokens';
  beforePublish?: BeforePublish;
  afterPublish?: AfterPublish;
}

export interface VideoAnalyzer {
  analyze(videoUrl: string): Promise<VideoAnalysis>;
}

export interface VideoAnalysis {
  focusRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  keypoints?: Array<{
    x: number;
    y: number;
    confidence: number;
    type: string;
  }>;
  saliencyMap?: Uint8Array;
  metadata?: {
    duration: number;
    fps: number;
    resolution: {
      width: number;
      height: number;
    };
  };
}

class ProcessingOwnershipLostError extends Error {}
export class SourceTooLargeError extends Error {}

/**
 * The route rejects an oversized source before billing, but a video uploaded
 * before the caps existed, or one the route could not probe, reaches here.
 * This runs against the measured source and before the first re-encode, so
 * the per-platform loop can never multiply unbounded work.
 */
const assertSourceWithinLimits = (analysis: VideoAnalysis): void => {
  const measured = analysis.metadata;
  // A partial measurement can't be judged either way. Both gates in front of
  // this probe a complete one, so only an analyzer that reported less than it
  // normally does lands here.
  if (!measured?.resolution) return;

  const violation = findSourceLimitViolation({
    durationSeconds: measured.duration,
    width: measured.resolution.width,
    height: measured.resolution.height,
  });
  if (violation) {
    throw new SourceTooLargeError(violation.message);
  }
};

class BasicVideoProcessor implements VideoProcessor {
  private config: VideoProcessingConfig;
  private analyzer: VideoAnalyzer;

  constructor(config: VideoProcessingConfig = defaultConfig) {
    this.config = config;
    this.analyzer = {
      analyze: analyzeVideo // Basic analyzer for MVP
    };
  }

  private async updateVideoStatus(
    videoId: string,
    status: Video['status'],
    error?: string,
    progress?: number,
    jobId?: string,
    expectedJobStatuses?: string[],
  ) {
    try {
      const updateData: any = { status, error };
      if (progress !== undefined) {
        updateData.progress = progress;
      }

      const update = supabase
        .from('processing_jobs')
        .update({ ...updateData, updated_at: new Date().toISOString() });
      let updateError;
      if (jobId) {
        let ownedUpdate: any = update.eq('id', jobId);
        if (expectedJobStatuses?.length) {
          ownedUpdate = ownedUpdate.in('status', expectedJobStatuses);
        }
        const result = await ownedUpdate.select('id').maybeSingle();
        updateError = result.error;
        if (!updateError && !result.data) {
          throw new ProcessingOwnershipLostError('Processing job is no longer active');
        }
      } else {
        const result = await update.eq('video_id', videoId);
        updateError = result.error;
      }

      if (updateError) {
        console.error('Failed to update processing job status:', updateError);
        throw updateError;
      }
    } catch (err) {
      console.error('Error updating processing job status:', err);
      throw err;
    }
  }



  async process(
    video: Video,
    platforms: string[],
    context: ProcessingRunContext,
  ): Promise<ProcessingOutcome> {
    const processingStatus = `processing_${context.billingPath}` as Video['status'];
    try {
      await this.updateVideoStatus(
        video.id, processingStatus, undefined, 0, context.jobId, [processingStatus],
      );

      // Ensure output directories exist. `/tmp/uploads` holds the
      // per-platform rendered mp4s and must be created alongside
      // `/tmp/processed`; Railway's container ships without it and
      // FFmpeg fails with "No such file or directory" otherwise.
      const processedDir = path.join('/tmp', 'processed');
      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }
      const tempDir = this.config.processingOptions.tempDir;
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // The bucket is private (F-012): mint a signed URL for FFmpeg/analysis
      // reads. The stored original_url is only a path identifier. This one
      // signature has to survive every platform render in the run, so it uses
      // the pipeline TTL rather than the short browser-facing default.
      const sourceUrl =
        (await StorageService.getSignedUrl(
          video.original_url,
          PIPELINE_SIGNED_URL_TTL_SECONDS,
        )) ?? video.original_url;

      // Analyze video to detect subjects and important regions
      const analysisResult = await this.analyzer.analyze(sourceUrl);
      assertSourceWithinLimits(analysisResult);
      await this.updateVideoStatus(
        video.id, processingStatus, undefined, 20, context.jobId, [processingStatus],
      );

      // Store analysis results
      const { data: ownedVideo, error: updateError } = await supabase
        .from('videos')
        .update({
          processing_metadata: {
            ...analysisResult,
            active_job_id: context.jobId,
            publication_state: 'active',
          },
        })
        .eq('id', video.id)
        .contains('processing_metadata', {
          active_job_id: context.jobId,
          publication_state: 'active',
        })
        .select('id')
        .maybeSingle();

      if (updateError) throw updateError;
      if (!ownedVideo) throw new Error('Processing run no longer owns this video');
      await this.updateVideoStatus(
        video.id, processingStatus, undefined, 30, context.jobId, [processingStatus],
      );

      // Process for each platform
      const platformOutputs: Record<string, any> = {};
      const platformCount = platforms.length;
      let completedPlatforms = 0;
      
      for (const platform of platforms) {
        const format = OUTPUT_FORMATS[platform];
        if (!format) continue;

        // A render writes no progress while it runs, so this is the only
        // window in which "stuck" and "working" look identical from outside.
        // Hold the lease across exactly that window and no longer.
        const stopHeartbeat = startExportHeartbeat(
          context.jobId,
          video.user_id,
          renderTimeoutMs(analysisResult.metadata?.duration),
        );
        try {
          // Process video according to platform requirements
          const outputPath = path.join(this.config.processingOptions.tempDir, `${video.id}-${platform}.mp4`);
          const outputUrl = await FFmpegService.processVideo(
            sourceUrl,
            outputPath,
            {
              width: format.width,
              height: format.height,
              aspectRatio: format.aspectRatio,
              filters: this.getFormatFilters(format),
              bitrate: format.bitrate,
              metadata: analysisResult.metadata
            },
            analysisResult.focusRegion ?? { x: 0, y: 0, width: 0, height: 0 },
            platform
          );

          platformOutputs[platform] = {
            url: outputUrl,
            format: format.aspectRatio,
            width: format.width,
            height: format.height,
            status: 'complete',
          };
          completedPlatforms++;
          // Update progress (30-90% based on platform completion)
          const progress = 30 + Math.floor((completedPlatforms / platformCount) * 60);
          await this.updateVideoStatus(
            video.id, processingStatus, undefined, progress, context.jobId, [processingStatus],
          );
        } catch (error) {
          if (error instanceof ProcessingOwnershipLostError) throw error;
          // Log the raw error (with ffmpeg stderr) server-side only.
          // Return a generic, stable message + opaque error id to the
          // client so we don't leak container internals / file paths /
          // the full ffmpeg build config to the browser.
          const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          console.error(`[${errorId}] Error processing video for ${platform}:`, error);
          platformOutputs[platform] = {
            error: `Processing failed for ${platform}. Please try again.`,
            errorId,
            status: 'error',
          };
          completedPlatforms++;
          // Update progress even for failed platforms
          const progress = 30 + Math.floor((completedPlatforms / platformCount) * 60);
          await this.updateVideoStatus(
            video.id, processingStatus, undefined, progress, context.jobId, [processingStatus],
          );
        } finally {
          stopHeartbeat();
        }
      }

      // Update progress to 90% before final update
      await this.updateVideoStatus(
        video.id, processingStatus, undefined, 90, context.jobId, [processingStatus],
      );

      const outcome: ProcessingOutcome = {
        successfulOutputs: Object.values(platformOutputs)
          .filter(output => output.status === 'complete').length,
        failedOutputs: Object.values(platformOutputs)
          .filter(output => output.status === 'error').length,
      };

      // A Gateway-token export is settled here, before completed output or a
      // terminal state becomes visible to the polling client. All-failed
      // runs skip settlement, so work that produced nothing is never charged.
      if (context.beforePublish) {
        await context.beforePublish(outcome);
      }
      const publishingStatus = outcome.successfulOutputs > 0
        ? `publishing_${context.billingPath}`
        : `publishing_no_charge_${context.billingPath}`;

      // Update video with processed outputs
      const { data: publishedVideo, error: updateError3 } = await supabase
        .from('videos')
        .update({
          status: Object.values(platformOutputs).some(output => output.status === 'error')
            ? 'failed'
            : 'completed',
          platform_outputs: platformOutputs,
          // Successful publication releases the ownership fence while
          // retaining the analysis payload used by the editor.
          processing_metadata: analysisResult,
        })
        .eq('id', video.id)
        .contains('processing_metadata', {
          active_job_id: context.jobId,
          publication_state: 'active',
        })
        .select('id')
        .maybeSingle();

      if (updateError3) throw updateError3;
      if (!publishedVideo) throw new Error('Processing run no longer owns this video');

      // Always jump to 100% at the end. 'failed' is a terminal state
      // too and the client uses progress=100 + status to unblock its
      // polling loop. Previously on any per-platform error we left the
      // row at 90% forever (user-visible "stuck at 90%").
      const finalStatus = Object.values(platformOutputs).some(output => output.status === 'error')
        ? 'failed'
        : 'completed';
      const finalizedByCaller = context.afterPublish
        ? await context.afterPublish(outcome)
        : false;
      if (!finalizedByCaller) {
        await this.updateVideoStatus(
          video.id, finalStatus, undefined, 100, context.jobId, [publishingStatus],
        );
      }
      return outcome;
    } catch (error) {
      console.error('Video processing failed:', error);
      // The controller owns terminal failure and compensation. Keeping the
      // last durable job state here lets a later status request distinguish
      // pre-charge processing from ambiguous settlement/publication failure.
      throw error;
    }
  }

  private getFormatFilters(format: OutputFormat): string[] {
    const filters: string[] = [];

    // Add format-specific filters
    switch (format.name) {
      case 'instagram-story':
      case 'tiktok':
      case 'youtube-shorts':
        filters.push('scale=1080:1920');
        break;
      case 'instagram-post':
        filters.push('scale=1080:1080');
        break;
      case 'twitter':
        filters.push('scale=1280:720');
        break;
      default:
        // Default to maintaining aspect ratio
        filters.push(`scale=${format.width}:${format.height}`);
    }

    // Note: yuv420p pixel format is set via -pix_fmt arg in FFmpegService

    return filters;
  }

}

// Export singleton instance for MVP
export const videoProcessor = new BasicVideoProcessor();

// Export processVideoForPlatforms as a wrapper for backward compatibility
export const processVideoForPlatforms = (
  video: Video,
  platforms: string[],
  context: ProcessingRunContext,
) => {
  return videoProcessor.process(video, platforms, context);
};
