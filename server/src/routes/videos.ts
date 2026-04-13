import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { supabase } from '../config/supabase';
import { StorageService } from '../services/storageService';
import { processVideoForPlatforms } from '../services/videoProcessingService';

// Extend Request type to include file from multer
interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

const router = Router();

// Configure multer for video upload
const upload = multer({
  dest: '/tmp/uploads/',
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
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

// Get user's videos
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    console.log('Fetching videos for user:', userId);

    console.log('GET /videos - Fetching videos for user:', userId);

    // First get all videos
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    console.log('Videos query result:', { videos, error: videosError });

    if (videosError) {
      console.error('Error fetching videos:', videosError);
      throw videosError;
    }
    if (!videos) {
      console.log('No videos found');
      return res.json([]);
    }

    console.log('Found videos:', videos.length);

    // Then get processing jobs for these videos
    const { data: jobs, error: jobsError } = await supabase
      .from('processing_jobs')
      .select('*')
      .in('video_id', videos.map(v => v.id));

    console.log('Jobs query result:', { jobs, error: jobsError });

    if (jobsError) {
      console.error('Error fetching jobs:', jobsError);
      throw jobsError;
    }

    // Combine videos with their jobs
    const videosWithJobs = videos.map(video => ({
      ...video,
      processing_jobs: jobs?.filter(job => job.video_id === video.id) || []
    }));

    console.log('Returning videos with jobs:', videosWithJobs);
    return res.json(videosWithJobs);
  } catch (error) {
    console.error('Error fetching videos:', error);
    return res.status(500).json({ error: 'Failed to fetch videos', details: error instanceof Error ? error.message : String(error) });
  }
});

// Upload video
router.post('/upload', requireAuth, upload.single('video'), async (req: MulterRequest, res: Response) => {
  let videoFile = null;
  try {
    const userId = (req as any).user.id;
    console.log('Processing video upload request:', {
      userId,
      hasFile: !!req.file,
      fileInfo: req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      } : null,
      body: req.body
    });

    if (!req.file) {
      return res.status(400).json({ error: 'Missing file' });
    }

    videoFile = req.file;
    const platforms = req.body.platforms;

    if (!platforms) {
      return res.status(400).json({
        error: 'Missing platforms array. Please provide target platforms for video processing.',
      });
    }

    // Parse platforms array
    let platformsArray;
    try {
      platformsArray = JSON.parse(platforms);
      if (!Array.isArray(platformsArray)) {
        return res.status(400).json({
          error: 'Platforms must be a JSON array.',
        });
      }
      if (platformsArray.length === 0) {
        return res.status(400).json({
          error: 'Platforms array cannot be empty. Please specify at least one target platform.',
        });
      }
      // Validate platform values
      const validPlatforms = ['youtube', 'instagram', 'tiktok'];
      for (const platform of platformsArray) {
        if (!validPlatforms.includes(platform)) {
          return res.status(400).json({
            error: `Invalid platform: ${platform}. Valid platforms are: ${validPlatforms.join(', ')}`
          });
        }
      }
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid platforms format. Must be a valid JSON array.',
        details: error instanceof Error ? error.message : String(error)
      });
    }

    // Verify file exists
    if (!fs.existsSync(videoFile.path)) {
      return res.status(500).json({
        error: 'Uploaded file not found on server',
        details: `File not found at path: ${videoFile.path}`
      });
    }

    // Verify file size
    const stats = fs.statSync(videoFile.path);
    console.log('Uploading video to storage:', {
      path: videoFile.path,
      originalname: videoFile.originalname,
      size: stats.size,
      mimetype: videoFile.mimetype
    });

    // Upload video to Supabase Storage
    let videoUrl: string;
    try {
      videoUrl = await StorageService.uploadVideo(
        videoFile.path,
        videoFile.originalname
      );
      console.log('Video uploaded successfully:', videoUrl);
    } catch (uploadError) {
      console.error('Failed to upload video:', uploadError);
      throw new Error(`Failed to upload video: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`);
    }

    // Create video record in database
    console.log('Creating video record:', {
      user_id: userId,
      original_url: videoUrl,
      platforms: platformsArray
    });

    // First create the video record
    const { data: video, error: dbError } = await supabase
      .from('videos')
      .insert({
        user_id: userId,
        original_url: videoUrl,
        status: 'pending',
        platform_outputs: {},
        title: req.body.title || null,
        description: req.body.description || null
      })
      .select()
      .single();

    if (dbError || !video) {
      console.error('Failed to create video record:', dbError);
      throw new Error(`Failed to create video record: ${dbError?.message || 'No data returned'}`);
    }

    // Then create the processing job
    const { error: jobError } = await supabase
      .from('processing_jobs')
      .insert({
        video_id: video.id,
        user_id: userId,
        platforms: platformsArray,
        status: 'pending',
        progress: 0
      });

    if (jobError) {
      console.error('Failed to create processing job:', jobError);
      throw new Error(`Failed to create processing job: ${jobError.message}`);
    }

    console.log('Video record created successfully:', video);

    // Start video processing in background
    processVideoForPlatforms(video, platformsArray).catch((error) => {
      console.error('Error processing video:', error);
    });

    return res.status(200).json(video);
  } catch (error) {
    console.error('Error uploading video:', {
      error,
      stack: error instanceof Error ? error.stack : undefined,
      videoFile: videoFile ? {
        path: videoFile.path,
        originalname: videoFile.originalname,
        size: videoFile.size,
        mimetype: videoFile.mimetype
      } : null
    });

    // Send appropriate error response
    let statusCode = 500;
    let errorMessage = 'Failed to upload video';
    let errorDetails = '';

    if (error instanceof Error) {
      errorDetails = error.message;
      // Check for specific error types
      if (error.message.includes('not found')) {
        statusCode = 404;
      } else if (error.message.includes('permission') || error.message.includes('access')) {
        statusCode = 403;
      } else if (error.message.includes('invalid') || error.message.includes('missing')) {
        statusCode = 400;
      }
    } else {
      errorDetails = String(error);
    }

    return res.status(statusCode).json({
      error: errorMessage,
      details: errorDetails,
      code: statusCode
    });
  } finally {
    // Clean up temp file if it exists
    if (videoFile?.path && fs.existsSync(videoFile.path)) {
      try {
        fs.unlinkSync(videoFile.path);
        console.log('Cleaned up temp file:', videoFile.path);
      } catch (cleanupError) {
        console.error('Failed to clean up temp file:', {
          path: videoFile.path,
          error: cleanupError
        });
      }
    }
  }
});

export default router;
