export interface Video {
  id: string;
  user_id: string;
  original_url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  platform_outputs: Record<string, PlatformOutput> | null;
  processing_metadata: {
    duration: number;
    fps: number;
    resolution: { width: number; height: number };
  } | null;
  title: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformOutput {
  url: string;
  format: string;
  width: number;
  height: number;
  status: 'pending' | 'processing' | 'complete' | 'error';
  progress?: number;
  error?: string;
}

export type ExportQuality = 'low' | 'medium' | 'high';

export const OUTPUT_FORMATS: Record<string, { name: string; aspectRatio: string; width: number; height: number; platform: string; type: string }> = {
  'instagram-story': { name: 'Instagram Story', aspectRatio: '9:16', width: 1080, height: 1920, platform: 'instagram', type: 'story' },
  'instagram-feed-square': { name: 'Instagram Feed (Square)', aspectRatio: '1:1', width: 1080, height: 1080, platform: 'instagram', type: 'feed' },
  'instagram-feed-portrait': { name: 'Instagram Feed (Portrait)', aspectRatio: '4:5', width: 1080, height: 1350, platform: 'instagram', type: 'feed' },
  'facebook-story': { name: 'Facebook Story', aspectRatio: '9:16', width: 1080, height: 1920, platform: 'facebook', type: 'story' },
  'facebook-feed': { name: 'Facebook Feed', aspectRatio: '1:1', width: 1080, height: 1080, platform: 'facebook', type: 'feed' },
  'tiktok': { name: 'TikTok', aspectRatio: '9:16', width: 1080, height: 1920, platform: 'tiktok', type: 'video' },
  'youtube-main': { name: 'YouTube', aspectRatio: '16:9', width: 1920, height: 1080, platform: 'youtube', type: 'main' },
  'youtube-shorts': { name: 'YouTube Shorts', aspectRatio: '9:16', width: 1080, height: 1920, platform: 'youtube', type: 'shorts' },
};
