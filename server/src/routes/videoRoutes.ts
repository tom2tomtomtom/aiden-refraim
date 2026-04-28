import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import multer, { MulterError } from 'multer';
import { requireAuth } from '../middleware/auth';
import {
  uploadVideo,
  getVideoById,
  getVideoStatus,
  processVideo,
  getUserVideos,
  deleteVideo,
  getVideoOutput
} from '../controllers/videoController';

const router = Router();

// DEFINITIVE upload size limit: 100 MB.
// This is the only active video upload router (mounted at /api/videos in app.ts).
// The old server/src/routes/videos.ts (which had a 500 MB limit) was unmounted
// and has been removed (BUG-RFM-002 / BUG-RFM-003).
// If you need to raise this limit, change MAX_UPLOAD_BYTES here and update the
// Railway service memory/disk settings accordingly. FFmpeg processing on large
// files can exceed the Railway free-tier memory limit.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      cb(new Error('Only video files are allowed'));
      return;
    }
    cb(null, true);
  }
});

// Convert multer-specific errors into clean HTTP status codes so the client
// can show useful messages instead of a generic 500.
function handleMulterError(err: unknown, req: Request, res: Response, next: NextFunction) {
  // If multer wrote any partial file before failing, best-effort clean it up.
  const tempPath = (req as any)?.file?.path as string | undefined;
  if (tempPath) {
    fs.promises.unlink(tempPath).catch(() => void 0);
  }
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        limitBytes: MAX_UPLOAD_BYTES,
        details: `Upload must be ≤ ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`,
      });
    }
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err instanceof Error && err.message === 'Only video files are allowed') {
    return res.status(415).json({ error: err.message });
  }
  return next(err);
}

// All routes require auth
router.use(requireAuth as any);

// Video management routes
router.post('/upload', upload.single('video'), handleMulterError, uploadVideo);
router.get('/user/videos', getUserVideos);
router.get('/:id', getVideoById);
router.delete('/:id', deleteVideo);

// Processing routes
router.get('/:id/status', getVideoStatus);
router.post('/:id/process', processVideo);

// Output download routes
router.get('/:id/outputs/:platform', getVideoOutput);

export default router;
