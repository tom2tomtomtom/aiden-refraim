import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { startScan, getScanStatus } from '../controllers/scanController';

const router = Router();

router.post('/:videoId/scan', requireAuth as any, startScan);
router.get('/:videoId/scan/:scanId/status', requireAuth as any, getScanStatus);

export default router;
