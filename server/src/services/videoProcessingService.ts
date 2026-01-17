import { supabase } from '../config/supabase';
import path from 'path';
import fs from 'fs';
import { analyzeVideo } from './videoAnalysisService';
import { OUTPUT_FORMATS, OutputFormat } from '../config/outputFormats';
import { FFmpegService } from './ffmpegService';
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
            analysisResult.focusRegion || { x: 0, y: 0, width: 1, height: 1 }
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

    // Add quality filters
    filters.push('format=yuv420p'); // Ensure compatibility

    return filters;
  }
}

// Export singleton instance for MVP
export const videoProcessor = new BasicVideoProcessor();

// Export processVideoForPlatforms as a wrapper for backward compatibility
export const processVideoForPlatforms = (video: Video, platforms: string[]) => {
  return videoProcessor.process(video, platforms);
};
