import { OutputFormat, OUTPUT_FORMATS } from './outputFormats';

export interface VideoProcessingConfig {
  maxSize: number;
  allowedFormats: string[];
  outputFormats: OutputFormat[];
  processingOptions: {
    useGPU: boolean;
    enableAI: boolean;
    chunkSize: number; // seconds per chunk
    tempDir: string;
  };
}

export const defaultConfig: VideoProcessingConfig = {
  maxSize: 1024 * 1024 * 100, // 100MB
  allowedFormats: ['video/mp4', 'video/quicktime', 'video/x-msvideo'],
  outputFormats: Object.values(OUTPUT_FORMATS),
  processingOptions: {
    useGPU: false, // Will be enabled in phase 2
    enableAI: false, // Will be enabled in phase 3
    chunkSize: 10, // seconds per chunk for distributed processing
    tempDir: '/tmp/uploads'
  }
};
