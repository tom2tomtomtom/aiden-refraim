export interface OutputFormat {
  name: string;
  aspectRatio: string;
  width: number;
  height: number;
  platform: string;
  type: string;
  bitrate?: string;
}

export const OUTPUT_FORMATS: Record<string, OutputFormat> = {
  'instagram-story': {
    name: 'instagram-story',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    platform: 'instagram',
    type: 'story',
  },
  'instagram-feed-square': {
    name: 'instagram-feed-square',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    platform: 'instagram',
    type: 'feed',
  },
  'instagram-feed-portrait': {
    name: 'instagram-feed-portrait',
    aspectRatio: '4:5',
    width: 1080,
    height: 1350,
    platform: 'instagram',
    type: 'feed',
  },
  'facebook-story': {
    name: 'facebook-story',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    platform: 'facebook',
    type: 'story',
  },
  'facebook-feed': {
    name: 'facebook-feed',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    platform: 'facebook',
    type: 'feed',
  },
  'tiktok': {
    name: 'tiktok',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    platform: 'tiktok',
    type: 'video',
  },
  'youtube-main': {
    name: 'youtube-main',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    platform: 'youtube',
    type: 'main',
  },
  'youtube-shorts': {
    name: 'youtube-shorts',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    platform: 'youtube',
    type: 'shorts',
  },
} as const;
