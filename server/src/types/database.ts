export interface Video {
  id: string;
  user_id: string;
  original_url: string;
  processed_url: string | null;
  status: 'pending' | 'UPLOADED' | 'PROCESSING' | 'COMPLETE' | 'ERROR';
  error: string | null;
  platforms: string[];
  title: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  // Populated by the processing pipeline. Stored as JSONB in Supabase,
  // so they're optional on the TS side; older rows may predate them.
  platform_outputs?: PlatformOutputs;
  processing_metadata?: ProcessingMetadata;
}

export interface ProcessingJob {
  id: string;
  created_at: string;
  updated_at: string;
  video_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'ERROR';
  progress: number;
  error: string | null;
  platforms: string[];
  user_id: string;
}

export interface PlatformOutputs {
  [platform: string]: {
    url: string;
    format: string;
    status: 'complete' | 'error';
    error?: string;
  };
}

export interface ProcessingMetadata {
  keyFrames: Array<{
    timestamp: number;
    boundingBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
      confidence: number;
    }>;
  }>;
  mainSubjects: Array<{
    type: 'face' | 'person' | 'object';
    trackingData: Array<{
      timestamp: number;
      x: number;
      y: number;
    }>;
  }>;
}
