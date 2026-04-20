import { Request, Response, NextFunction } from 'express';
import { verifyGatewayJWT, GW_COOKIE_NAME } from '../lib/gateway-jwt';
import { AuthenticatedRequest } from '../types/express';

/**
 * Authentication for refrAIm's API.
 *
 * Primary path: the Gateway-issued `aiden-gw` JWT cookie (HS256, shared
 * JWT_SECRET across all hub apps). When the user's browser hits
 * refraim.aiden.services, the cookie travels automatically because it's
 * scoped to `.aiden.services`.
 *
 * Fallback: `Authorization: Bearer <jwt>` header, same HS256 secret. Kept
 * so programmatic clients and the legacy access-token header still work.
 *
 * No Supabase Auth call. The Gateway is the sole auth authority for the
 * whole platform; other apps trust the signed JWT.
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const cookieHeader = req.headers.cookie;
    const cookieToken = extractCookie(cookieHeader, GW_COOKIE_NAME);
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

    const token = cookieToken || bearerToken;
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const payload = await verifyGatewayJWT(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    (req as AuthenticatedRequest).user = {
      id: payload.sub,
      email: payload.email,
      aud: 'authenticated',
    };
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

function extractCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}
