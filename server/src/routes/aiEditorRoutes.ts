import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAIFocusStrategy } from '../controllers/aiEditorController';

const router = Router();

router.post('/:videoId/ai-edit', requireAuth as any, getAIFocusStrategy as any);

export default router;
