import { supabase } from '../config/supabase';
import path from 'path';
import fs from 'fs';
import { analyzeVideo } from './videoAnalysisService';
import { OUTPUT_FORMATS, OutputFormat } from '../config/outputFormats';
import { FFmpegService, FocusPoint } from './ffmpegService';
import { defaultConfig, VideoProcessingConfig } from '../config/videoProcessing';

interface Video {
  id: string;
  user_id: string;
  original_url: string;
  processed_url?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  platforms: string[];
  processing_metadata?: VideoAnalysis;
  platform_outputs?: Record<string, {
    url: string;
    format: string;
    width: number;
    height: number;
    status: 'complete' | 'error';
    error?: string;
  }>;
}

export interface VideoProcessor {
  process(video: Video, platforms: string[]): Promise<void>;
  processWithFocusPoints(
    video: Video,
    platforms: string[],
    options?: { letterbox?: boolean; quality?: 'low' | 'medium' | 'high' }
  ): Promise<void>;
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

class BasicVideoProcessor implements VideoProcessor {
  private config: VideoProcessingConfig;
  private analyzer: VideoAnalyzer;

  constructor(config: VideoProcessingConfig = defaultConfig) {
    this.config = config;
    this.analyzer = {
      analyze: analyzeVideo // Basic analyzer for MVP
    };
  }

  private async updateVideoStatus(videoId: string, status: Video['status'], error?: string, progress?: number) {
    try {
      const updateData: any = { status, error };
      if (progress !== undefined) {
        updateData.progress = progress;
      }

      const { error: updateError } = await supabase
        .from('processing_jobs')
        .update(updateData)
        .eq('video_id', videoId);

      if (updateError) {
        console.error('Failed to update processing job status:', updateError);
        throw updateError;
      }
    } catch (err) {
      console.error('Error updating processing job status:', err);
      throw err;
    }
  }



  async process(video: Video, platforms: string[]): Promise<void> {
    try {
      await this.updateVideoStatus(video.id, 'processing', undefined, 0);

      // Ensure processed directory exists
      const processedDir = path.join('/tmp', 'processed');
      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }

      // Analyze video to detect subjects and important regions
      const analysisResult = await this.analyzer.analyze(video.original_url);
      await this.updateVideoStatus(video.id, 'processing', undefined, 20);

      // Store analysis results
      const { error: updateError } = await supabase
        .from('videos')
        .update({ processing_metadata: analysisResult })
        .eq('id', video.id);

      if (updateError) throw updateError;
      await this.updateVideoStatus(video.id, 'processing', undefined, 30);

      // Process for each platform
      const platformOutputs: Record<string, any> = {};
      const platformCount = platforms.length;
      let completedPlatforms = 0;
      
      for (const platform of platforms) {
        const format = OUTPUT_FORMATS[platform];
        if (!format) continue;

        try {
          // Process video according to platform requirements
          const outputPath = path.join(this.config.processingOptions.tempDir, `${video.id}-${platform}.mp4`);
          const outputUrl = await FFmpegService.processVideo(
            video.original_url,
            outputPath,
            {
              width: format.width,
              height: format.height,
              aspectRatio: format.aspectRatio,
              filters: this.getFormatFilters(format),
              bitrate: format.bitrate,
              metadata: analysisResult.metadata
            },
            analysisResult.focusRegion ?? { x: 0, y: 0, width: 0, height: 0 }
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
        } catch (error) {
          console.error(`Error processing video for ${platform}:`, error);
          platformOutputs[platform] = {
            error: error instanceof Error ? error.message : 'Processing failed',
            status: 'error',
          };
          completedPlatforms++;
          // Update progress even for failed platforms
          const progress = 30 + Math.floor((completedPlatforms / platformCount) * 60);
        }
      }

      // Update progress to 90% before final update
      await this.updateVideoStatus(video.id, 'processing', undefined, 90);

      // Update video with processed outputs
      const { error: updateError3 } = await supabase
        .from('videos')
        .update({
          status: Object.values(platformOutputs).some(output => output.status === 'error')
            ? 'failed'
            : 'completed',
          platform_outputs: platformOutputs
        })
        .eq('id', video.id);

      if (updateError3) throw updateError3;

      // Set final progress to 100% for completed videos
      if (!Object.values(platformOutputs).some(output => output.status === 'error')) {
        await this.updateVideoStatus(video.id, 'completed', undefined, 100);
      }

    } catch (error) {
      console.error('Video processing failed:', error);
      await this.updateVideoStatus(
        video.id,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
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

  /**
   * Enhanced processing pipeline that reads focus points from the database
   * and uses multi-segment focus-point-aware cropping.
   */
  async processWithFocusPoints(
    video: Video,
    platforms: string[],
    options: { letterbox?: boolean; quality?: 'low' | 'medium' | 'high' } = {}
  ): Promise<void> {
    const letterbox = options.letterbox ?? false;
    const quality = options.quality ?? 'medium';

    try {
      await this.updateVideoStatus(video.id, 'processing', undefined, 0);

      // Ensure processed directory exists
      const processedDir = path.join('/tmp', 'processed');
      if (!fs.existsSync(processedDir)) {
        fs.mkdirSync(processedDir, { recursive: true });
      }

      // Fetch focus points for this video
      const { data: focusPoints, error: fpError } = await supabase
        .from('focus_points')
        .select('*')
        .eq('video_id', video.id)
        .order('time_start');

      if (fpError) {
        console.error('Failed to fetch focus points:', fpError);
        throw fpError;
      }

      const typedFocusPoints: FocusPoint[] = (focusPoints || []).map((fp: any) => ({
        time_start: fp.time_start,
        time_end: fp.time_end,
        x: fp.x,
        y: fp.y,
        description: fp.description || '',
      }));

      await this.updateVideoStatus(video.id, 'processing', undefined, 10);

      // Analyze video for metadata (still useful for storing analysis)
      const analysisResult = await this.analyzer.analyze(video.original_url);
      await this.updateVideoStatus(video.id, 'processing', undefined, 20);

      // Store analysis results
      const { error: updateError } = await supabase
        .from('videos')
        .update({ processing_metadata: analysisResult })
        .eq('id', video.id);

      if (updateError) throw updateError;
      await this.updateVideoStatus(video.id, 'processing', undefined, 30);

      // Process for each platform
      const platformOutputs: Record<string, any> = {};
      const platformCount = platforms.length;
      let completedPlatforms = 0;

      for (const platform of platforms) {
        const format = OUTPUT_FORMATS[platform];
        if (!format) continue;

        try {
          const outputPath = path.join(
            this.config.processingOptions.tempDir,
            `${video.id}-${platform}.mp4`
          );

          if (typedFocusPoints.length > 0) {
            // Use new segment-based processing with focus points
            await FFmpegService.processVideoWithSegments(
              video.original_url,
              outputPath,
              {
                width: format.width,
                height: format.height,
                aspectRatio: format.aspectRatio,
              },
              typedFocusPoints,
              { letterbox, quality }
            );
          } else {
            // Fall back to original processing when no focus points exist
            const fallbackRegion = analysisResult.focusRegion || { x: 0, y: 0, width: 0, height: 0 };
            await FFmpegService.processVideo(
              video.original_url,
              outputPath,
              {
                width: format.width,
                height: format.height,
                aspectRatio: format.aspectRatio,
                filters: this.getFormatFilters(format),
                bitrate: format.bitrate,
                metadata: analysisResult.metadata,
              },
              fallbackRegion
            );
          }

          platformOutputs[platform] = {
            url: outputPath,
            format: format.aspectRatio,
            width: format.width,
            height: format.height,
            status: 'complete',
          };
          completedPlatforms++;
          const progress = 30 + Math.floor((completedPlatforms / platformCount) * 60);
          await this.updateVideoStatus(video.id, 'processing', undefined, progress);
        } catch (error) {
          console.error(`Error processing video for ${platform}:`, error);
          platformOutputs[platform] = {
            error: error instanceof Error ? error.message : 'Processing failed',
            status: 'error',
          };
          completedPlatforms++;
          const progress = 30 + Math.floor((completedPlatforms / platformCount) * 60);
          await this.updateVideoStatus(video.id, 'processing', undefined, progress);
        }
      }

      await this.updateVideoStatus(video.id, 'processing', undefined, 90);

      // Update video with processed outputs
      const { error: updateError3 } = await supabase
        .from('videos')
        .update({
          status: Object.values(platformOutputs).some(output => output.status === 'error')
            ? 'failed'
            : 'completed',
          platform_outputs: platformOutputs,
        })
        .eq('id', video.id);

      if (updateError3) throw updateError3;

      if (!Object.values(platformOutputs).some(output => output.status === 'error')) {
        await this.updateVideoStatus(video.id, 'completed', undefined, 100);
      }
    } catch (error) {
      console.error('Video processing with focus points failed:', error);
      await this.updateVideoStatus(
        video.id,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }
}

// Export singleton instance for MVP
export const videoProcessor = new BasicVideoProcessor();

// Export processVideoForPlatforms as a wrapper for backward compatibility
export const processVideoForPlatforms = (video: Video, platforms: string[]) => {
  return videoProcessor.process(video, platforms);
};
