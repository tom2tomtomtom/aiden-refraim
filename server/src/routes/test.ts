import { Router } from 'express';
import { processVideoForPlatforms } from '../services/videoProcessingService';
import { supabase } from '../config/supabase';
import { DatabaseService } from '../services/databaseService';
import multer from 'multer';
import path from 'path';
import { StorageService } from '../services/storageService';

const router = Router();

// Test routes are dev-only
if (process.env.NODE_ENV !== 'production') {
  // Configure multer for video upload
  const upload = multer({
    dest: '/tmp/uploads/',
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only MP4, MOV, and AVI are allowed.'));
      }
    },
  });

  router.post('/test-video-processing', upload.single('video'), async (req, res) => {
    try {
      const { platforms } = req.body;
      const videoFile = req.file;

      if (!videoFile || !platforms) {
        return res.status(400).json({
          error: 'Missing required fields. Please provide video file and platforms array.',
        });
      }

      // Parse platforms array
      const platformsArray = JSON.parse(platforms);
      if (!Array.isArray(platformsArray)) {
        return res.status(400).json({
          error: 'Platforms must be a JSON array.',
        });
      }

      // Upload video to Supabase Storage
      const videoUrl = await StorageService.uploadVideo(
        videoFile.path,
        videoFile.originalname
      );

      // Create video record in Supabase
      const { data: video, error } = await supabase
        .from('videos')
        .insert({
          title: req.body.title || 'Test Video',
          description: req.body.description,
          originalUrl: videoUrl,
          status: 'pending',
          userId: 'test-user'
        })
        .select()
        .single();

      if (error) throw error;

      // Start processing
      processVideoForPlatforms(video, platformsArray)
        .then(() => console.log('Video processing completed'))
        .catch((error) => console.error('Video processing failed:', error));

      res.json({
        message: 'Video processing started',
        videoId: video.id,
        originalUrl: videoUrl,
      });
    } catch (error) {
      console.error('Error in test endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/video-status/:videoId', async (req, res) => {
    try {
      const { videoId } = req.params;
      const { data: video, error } = await supabase
        .from('videos')
        .select('*')
        .eq('id', videoId)
        .single();

      if (error) throw error;

      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }

      res.json({
        status: video.status,
        platform_outputs: video.platform_outputs,
        processing_metadata: video.processing_metadata,
      });
    } catch (error) {
      console.error('Error getting video status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/test-platforms', (req, res) => {
    res.json({
      availablePlatforms: [
        'instagram-story',
        'instagram-feed-square',
        'instagram-feed-portrait',
        'facebook-story',
        'facebook-feed',
        'tiktok',
        'youtube-main',
        'youtube-shorts',
      ],
    });
  });
} else {
  router.all('*', (_req: any, res: any) => res.status(404).json({ error: 'Not available in production' }));
}

export default router;
