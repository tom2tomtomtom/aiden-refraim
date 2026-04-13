import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  listFocusPoints,
  createFocusPoints,
  updateFocusPoint,
  deleteFocusPoint,
  deleteAllFocusPoints,
} from '../controllers/focusPointController';

const router = Router();

router.get('/:videoId/focus-points', requireAuth, listFocusPoints);
router.post('/:videoId/focus-points', requireAuth, createFocusPoints);
router.put('/:videoId/focus-points/:fpId', requireAuth, updateFocusPoint);
router.delete('/:videoId/focus-points/:fpId', requireAuth, deleteFocusPoint);
router.delete('/:videoId/focus-points', requireAuth, deleteAllFocusPoints);

export default router;
