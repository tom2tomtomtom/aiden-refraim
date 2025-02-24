import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import path from 'path';
import { StorageService } from './storageService';

interface ProcessingFormat {
  width: number;
  height: number;
  aspectRatio: string;
  filters?: string[];
  bitrate?: string;
  metadata?: {
    duration?: number;
    fps?: number;
    resolution?: {
      width: number;
      height: number;
    };
  };
}

export class FFmpegService {
  private static async getVideoMetadata(inputPath: string): Promise<{
    width: number;
    height: number;
    duration: number;
    fps: number;
  }> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height,duration,r_frame_rate',
        '-of',
        'json',
        inputPath,
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('Failed to get video metadata'));
          return;
        }

        try {
          const metadata = JSON.parse(output);
          const stream = metadata.streams[0];
          const [num, den] = stream.r_frame_rate.split('/');
          resolve({
            width: stream.width,
            height: stream.height,
            duration: parseFloat(stream.duration),
            fps: Math.round(parseInt(num) / parseInt(den))
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private static calculateCropParameters(
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    focusRegion: { x: number; y: number; width: number; height: number }
  ): { x: number; y: number; width: number; height: number } {
    // Calculate target aspect ratio
    const targetAspectRatio = targetWidth / targetHeight;

    // Calculate crop dimensions
    let cropWidth = sourceWidth;
    let cropHeight = sourceHeight;

    if (sourceWidth / sourceHeight > targetAspectRatio) {
      // Source is wider than target
      cropWidth = Math.round(sourceHeight * targetAspectRatio);
      cropHeight = sourceHeight;
    } else {
      // Source is taller than target
      cropWidth = sourceWidth;
      cropHeight = Math.round(sourceWidth / targetAspectRatio);
    }

    // Calculate crop position based on focus region
    let x = Math.round(
      focusRegion.x + (focusRegion.width - cropWidth) / 2
    );
    let y = Math.round(
      focusRegion.y + (focusRegion.height - cropHeight) / 2
    );

    // Ensure crop region stays within video bounds
    x = Math.max(0, Math.min(x, sourceWidth - cropWidth));
    y = Math.max(0, Math.min(y, sourceHeight - cropHeight));

    return { x, y, width: cropWidth, height: cropHeight };
  }

  static async processVideo(
    inputUrl: string,
    outputPath: string,
    format: ProcessingFormat,
    focusRegion: { x: number; y: number; width: number; height: number }
  ): Promise<string> {
    // Download video to temp location
    const tempInputPath = path.join('/tmp', `input-${Date.now()}.mp4`);
    await StorageService.downloadVideo(inputUrl, tempInputPath);

    // Get video metadata
    const metadata = await this.getVideoMetadata(tempInputPath);

    // Calculate crop parameters
    const crop = this.calculateCropParameters(
      metadata.width,
      metadata.height,
      format.width,
      format.height,
      focusRegion
    );

    // Create FFmpeg command
    const args = [
      '-i',
      tempInputPath,
      '-vf',
      `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${format.width}:${format.height}`,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outputPath,
    ];

    // Add any additional filters
    if (format.filters) {
      args.splice(3, 0, ...format.filters);
    }

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);

      // Collect error output
      let errorOutput = '';
      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg failed: ${errorOutput}`));
          return;
        }

        try {
          // Upload processed video to storage
          const platform = path.basename(outputPath, path.extname(outputPath)).split('-')[1];
          const outputUrl = await StorageService.uploadProcessedVideo(
            outputPath,
            platform,
            path.basename(inputUrl)
          );
          resolve(outputUrl);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}
