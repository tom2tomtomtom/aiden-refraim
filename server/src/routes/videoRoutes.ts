import { Router } from 'express';
import multer from 'multer';
import { 
  uploadVideo,
  getVideoById,
  getVideoStatus,
  processVideo,
  getUserVideos,
  deleteVideo
} from '../controllers/videoController';

const router = Router();
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      cb(new Error('Only video files are allowed'));
      return;
    }
    cb(null, true);
  }
});

// Video management routes
router.post('/upload', upload.single('video'), uploadVideo);
router.get('/user/videos', getUserVideos);
router.get('/:id', getVideoById);
router.delete('/:id', deleteVideo);

// Processing routes
router.get('/:id/status', getVideoStatus);
router.post('/:id/process', processVideo);

export const videoRoutes = router;
