import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAIFocusStrategy, reviewCropQuality } from '../controllers/aiEditorController';

const router = Router();

router.post('/:videoId/ai-edit', requireAuth as any, getAIFocusStrategy as any);
router.post('/:videoId/review-crops', requireAuth as any, reviewCropQuality as any);

export default router;
