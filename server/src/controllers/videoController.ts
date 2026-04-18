import { Request, Response } from 'express';
import fs from 'fs';
import { processVideoForPlatforms } from '../services/videoProcessingService';
import { StorageService } from '../services/storageService';
import { DatabaseService } from '../services/databaseService';
import { supabase } from '../config/supabase';
import { checkTokens, deductTokens } from '../lib/gateway-tokens';

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
    // ENOENT is fine — storage service may have already removed it.
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

    res.status(201).json(video);
  } catch (error) {
    safeUnlink(tempPath);
    console.error('Error in uploadVideo:', {
      error,
      file: req.file,
      user: (req as any).user,
    });

    if (error instanceof Error) {
      if (error.message.includes('storage')) {
        return res.status(500).json({
          error: 'Storage error',
          details: error.message,
        });
      } else if (error.message.includes('database')) {
        return res.status(500).json({
          error: 'Database error',
          details: error.message,
        });
      }
    }

    res.status(500).json({
      error: 'Error uploading video',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
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

    res.json(video);
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
    const video = await DatabaseService.getVideo(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.user_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({
      status: video.status,
      platformOutputs: video.platform_outputs
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

    // Gate on token balance before starting processing
    if (process.env.AIDEN_SERVICE_KEY) {
      const tokenCheck = await checkTokens(user.id, 'refraim', 'video_export');
      if (!tokenCheck.allowed) {
        return res.status(402).json({
          error: 'Insufficient tokens',
          required: tokenCheck.required,
          balance: tokenCheck.balance,
        });
      }
    }

    const processingJob = await DatabaseService.createProcessingJob({
      video_id: id,
      platforms,
      status: 'PENDING',
      progress: 0,
      user_id: user.id
    });

    // Start processing asynchronously; deduct tokens only on success
    processVideoForPlatforms(video, platforms)
      .then(() => {
        if (process.env.AIDEN_SERVICE_KEY) {
          deductTokens(user.id, 'refraim', 'video_export').catch((err: Error) =>
            console.error('[gateway-tokens] Deduct error:', err)
          );
        }
      })
      .catch(console.error);

    res.json(processingJob);
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
    res.json(videos);
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

    // Delete from storage
    await StorageService.deleteVideo(video.original_url);
    if (video.platform_outputs) {
      const outputs = Object.values(video.platform_outputs) as Array<{ url?: string }>;
      for (const platform of outputs) {
        if (platform?.url) {
          await StorageService.deleteVideo(platform.url);
        }
      }
    }

    // Delete from database
    await DatabaseService.deleteVideo(id);

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

    return res.json({
      url: outputs[platform].url,
      platform,
      format: outputs[platform].format || platform,
      file_size: outputs[platform].file_size || 0,
    });
  } catch (error) {
    console.error('Error getting video output:', error);
    return res.status(500).json({ error: 'Failed to get video output' });
  }
};
