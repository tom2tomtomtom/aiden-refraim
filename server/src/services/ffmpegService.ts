import { spawn } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
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

export interface CropSegment {
  startTime: number;
  endTime: number;
  focusX: number;  // 0-1
  focusY: number;  // 0-1
  label: string;
}

export interface FocusPoint {
  time_start: number;
  time_end: number;
  x: number;
  y: number;
  description: string;
}

type QualityPreset = 'low' | 'medium' | 'high';

const QUALITY_PRESETS: Record<QualityPreset, { preset: string; crf: string }> = {
  low: { preset: 'veryfast', crf: '28' },
  medium: { preset: 'medium', crf: '23' },
  high: { preset: 'slow', crf: '18' },
};

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

    // Build filter chain
    let filterChain = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${format.width}:${format.height}`;
    if (format.filters && format.filters.length > 0) {
      filterChain += ',' + format.filters.join(',');
    }

    // Create FFmpeg command
    const args = [
      '-i',
      tempInputPath,
      '-vf',
      filterChain,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      '-y',
      outputPath,
    ];

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

  /**
   * Build timeline segments from focus points, filling gaps with center-crop.
   */
  static buildSegments(
    focusPoints: FocusPoint[],
    videoDuration: number
  ): CropSegment[] {
    const sorted = [...focusPoints].sort((a, b) => a.time_start - b.time_start);
    const segments: CropSegment[] = [];
    let cursor = 0;

    for (const fp of sorted) {
      const start = Math.max(fp.time_start, cursor);
      const end = fp.time_end;

      // Skip zero-length or fully overlapped segments
      if (end <= start) continue;

      // Fill gap before this focus point with center-crop
      if (start > cursor) {
        segments.push({
          startTime: cursor,
          endTime: start,
          focusX: 0.5,
          focusY: 0.5,
          label: 'center-fill',
        });
      }

      segments.push({
        startTime: start,
        endTime: end,
        focusX: fp.x / 100,
        focusY: fp.y / 100,
        label: fp.description || 'focus',
      });

      cursor = end;
    }

    // Fill gap after last focus point
    if (cursor < videoDuration) {
      segments.push({
        startTime: cursor,
        endTime: videoDuration,
        focusX: 0.5,
        focusY: 0.5,
        label: 'center-fill',
      });
    }

    return segments;
  }

  /**
   * Build FFmpeg filter chain for a single segment based on focus point and mode.
   */
  private static buildCropFilter(
    focusX: number,
    focusY: number,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    letterbox: boolean
  ): string {
    if (letterbox) {
      // Crop to largest square centered on focus, then scale and pad
      const squareSize = Math.min(sourceWidth, sourceHeight);
      let cx = Math.round(focusX * sourceWidth - squareSize / 2);
      let cy = Math.round(focusY * sourceHeight - squareSize / 2);
      cx = Math.max(0, Math.min(cx, sourceWidth - squareSize));
      cy = Math.max(0, Math.min(cy, sourceHeight - squareSize));

      // Scale to fit within target while maintaining aspect ratio
      const scaleW = targetWidth;
      const scaleH = targetHeight;

      return [
        `crop=${squareSize}:${squareSize}:${cx}:${cy}`,
        `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=decrease`,
        `pad=${scaleW}:${scaleH}:(ow-iw)/2:(oh-ih)/2:black`,
      ].join(',');
    }

    // Fill/crop mode: crop to target aspect ratio centered on focus
    const targetAR = targetWidth / targetHeight;
    const sourceAR = sourceWidth / sourceHeight;

    let cropW: number;
    let cropH: number;

    if (sourceAR > targetAR) {
      // Source wider than target: constrain by height
      cropH = sourceHeight;
      cropW = Math.round(sourceHeight * targetAR);
    } else {
      // Source taller than target: constrain by width
      cropW = sourceWidth;
      cropH = Math.round(sourceWidth / targetAR);
    }

    let cx = Math.round(focusX * sourceWidth - cropW / 2);
    let cy = Math.round(focusY * sourceHeight - cropH / 2);
    cx = Math.max(0, Math.min(cx, sourceWidth - cropW));
    cy = Math.max(0, Math.min(cy, sourceHeight - cropH));

    return [
      `crop=${cropW}:${cropH}:${cx}:${cy}`,
      `scale=${targetWidth}:${targetHeight}`,
    ].join(',');
  }

  /**
   * Run a single FFmpeg command and return a promise.
   */
  private static runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      let errorOutput = '';
      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`FFmpeg failed: ${errorOutput}`));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Process video with multi-segment focus-point-aware cropping.
   */
  static async processVideoWithSegments(
    inputPath: string,
    outputPath: string,
    format: { width: number; height: number; aspectRatio: string },
    focusPoints: FocusPoint[],
    options: { letterbox: boolean; quality: QualityPreset }
  ): Promise<string> {
    // Download to temp if it's a URL
    let localInput = inputPath;
    const isUrl = inputPath.startsWith('http://') || inputPath.startsWith('https://');
    if (isUrl) {
      localInput = path.join('/tmp', `input-seg-${Date.now()}.mp4`);
      await StorageService.downloadVideo(inputPath, localInput);
    }

    const metadata = await this.getVideoMetadata(localInput);
    const segments = this.buildSegments(focusPoints, metadata.duration);
    const quality = QUALITY_PRESETS[options.quality];

    // Single segment: process directly
    if (segments.length <= 1) {
      const seg = segments[0] || { focusX: 0.5, focusY: 0.5, startTime: 0, endTime: metadata.duration };
      const filter = this.buildCropFilter(
        seg.focusX,
        seg.focusY,
        metadata.width,
        metadata.height,
        format.width,
        format.height,
        options.letterbox
      );

      const args = [
        '-y', '-i', localInput,
        '-vf', filter,
        '-c:v', 'libx264',
        '-preset', quality.preset,
        '-crf', quality.crf,
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath,
      ];

      await this.runFfmpeg(args);

      // Clean up temp input
      if (isUrl && existsSync(localInput)) unlinkSync(localInput);

      return outputPath;
    }

    // Multiple segments: process each, then concat
    const segmentFiles: string[] = [];
    const concatListPath = path.join('/tmp', `concat-${Date.now()}.txt`);

    try {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const segPath = path.join('/tmp', `seg-${Date.now()}-${i}.mp4`);
        segmentFiles.push(segPath);

        const filter = this.buildCropFilter(
          seg.focusX,
          seg.focusY,
          metadata.width,
          metadata.height,
          format.width,
          format.height,
          options.letterbox
        );

        const duration = seg.endTime - seg.startTime;
        const args = [
          '-y', '-i', localInput,
          '-ss', String(seg.startTime),
          '-t', String(duration),
          '-vf', filter,
          '-c:v', 'libx264',
          '-preset', quality.preset,
          '-crf', quality.crf,
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          segPath,
        ];

        await this.runFfmpeg(args);
      }

      // Write concat list file
      const { writeFileSync } = await import('fs');
      const concatContent = segmentFiles.map(f => `file '${f}'`).join('\n');
      writeFileSync(concatListPath, concatContent);

      // Concat all segments
      const concatArgs = [
        '-y', '-f', 'concat', '-safe', '0',
        '-i', concatListPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        outputPath,
      ];

      await this.runFfmpeg(concatArgs);

      return outputPath;
    } finally {
      // Clean up temp files
      for (const f of segmentFiles) {
        if (existsSync(f)) unlinkSync(f);
      }
      if (existsSync(concatListPath)) unlinkSync(concatListPath);
      if (isUrl && existsSync(localInput)) unlinkSync(localInput);
    }
  }
}
