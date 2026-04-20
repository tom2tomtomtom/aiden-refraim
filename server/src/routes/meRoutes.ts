import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/express';

const router = Router();

/**
 * Thin "who am I" endpoint the client polls on mount to confirm the
 * Gateway session is live. Returns 200 with the decoded JWT claims, or
 * 401 (handled by requireAuth) so the client can redirect to Gateway
 * login.
 */
router.get('/', requireAuth, (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  res.json({
    id: user.id,
    email: user.email,
  });
});

export default router;
