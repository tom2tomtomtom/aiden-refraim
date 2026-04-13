import { Request, Response, NextFunction } from 'express';
import { authClient } from '../config/supabase';
import { AuthenticatedRequest } from '../types/express';

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      console.error('No bearer token found');
      return res.status(401).json({ error: 'No token provided' });
    }

    const jwt = authHeader.split(' ')[1];
    if (!jwt) {
      console.error('Empty token');
      return res.status(401).json({ error: 'Empty token' });
    }

    console.log('Verifying JWT, hasToken:', !!jwt);

    // Directly get user from JWT
    const { data: { user }, error: userError } = await authClient.auth.getUser(jwt);

    if (userError) {
      console.error('Failed to get user from JWT:', userError.message);
      return res.status(401).json({
        error: 'Invalid JWT',
        details: userError.message
      });
    }

    if (!user) {
      console.error('No user found from JWT');
      return res.status(401).json({ error: 'User not found' });
    }

    console.log('Successfully authenticated userId:', user.id);

    // Add user to request object for use in route handlers
    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
