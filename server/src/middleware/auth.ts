import { Request, Response, NextFunction } from 'express';
import { verifyGatewayJWT, GW_COOKIE_NAME } from '../lib/gateway-jwt';
import { AuthenticatedRequest } from '../types/express';

const RT_COOKIE_NAME = 'aiden-gw-rt';
const DEFAULT_GATEWAY_URL = 'https://www.aiden.services';
const ACCESS_COOKIE_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Authentication for refrAIm's API.
 *
 * Primary path: the Gateway-issued `aiden-gw` JWT cookie (HS256, shared
 * JWT_SECRET across all hub apps). When the user's browser hits
 * refraim.aiden.services, the cookie travels automatically because it's
 * scoped to `.aiden.services`.
 *
 * Programmatic clients may supply the same JWT as `Authorization: Bearer`.
 * If the access JWT is absent or invalid, browsers can recover from the
 * durable `aiden-gw-rt` cookie through Gateway's server-only access route.
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
    if (token) {
      const payload = await verifyGatewayJWT(token);
      if (payload) {
        setAuthenticatedUser(req, payload.sub, payload.email);
        next();
        return;
      }
    }

    const refreshToken = extractCookie(cookieHeader, RT_COOKIE_NAME);
    if (!refreshToken) {
      return res.status(401).json({
        error: token ? 'Invalid or expired token' : 'No token provided',
      });
    }

    let accessResponse: globalThis.Response;
    try {
      const gatewayUrl = (process.env.GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
      accessResponse = await fetch(`${gatewayUrl}/api/auth/access`, {
        method: 'POST',
        headers: { Cookie: `${RT_COOKIE_NAME}=${refreshToken}` },
        cache: 'no-store',
      });
    } catch {
      return res.status(503).json({ error: 'Authentication service unavailable' });
    }

    if (!accessResponse.ok) {
      const status = accessResponse.status === 401 || accessResponse.status === 403
        ? 401
        : 503;
      const error = status === 401
        ? 'Invalid or expired token'
        : 'Authentication service unavailable';
      return res.status(status).json({ error });
    }

    let body: unknown;
    try {
      body = await accessResponse.json();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const freshToken = getAccessToken(body);
    if (!freshToken) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const freshPayload = await verifyGatewayJWT(freshToken);
    if (!freshPayload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    setAuthenticatedUser(req, freshPayload.sub, freshPayload.email);
    res.cookie(GW_COOKIE_NAME, freshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      ...(process.env.NODE_ENV === 'production' ? { domain: '.aiden.services' } : {}),
      path: '/',
      sameSite: 'lax',
      maxAge: ACCESS_COOKIE_MAX_AGE_MS,
    });
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

function setAuthenticatedUser(req: Request, id: string, email: string): void {
  (req as AuthenticatedRequest).user = {
    id,
    email,
    aud: 'authenticated',
  };
}

function getAccessToken(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('jwt' in body)) return undefined;
  return typeof body.jwt === 'string' && body.jwt ? body.jwt : undefined;
}

function extractCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}
