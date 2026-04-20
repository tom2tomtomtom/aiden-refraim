import { jwtVerify, type JWTPayload } from 'jose';

export const GW_COOKIE_NAME = 'aiden-gw';

export interface GatewayJWTPayload extends JWTPayload {
  sub: string;
  email: string;
  iss: string;
}

/**
 * Verify a Gateway-issued JWT. Returns the payload on success, null on any
 * failure (missing secret, bad signature, expired, wrong issuer, missing
 * required claims). Never throws.
 *
 * JWT_SECRET must match the value set on the Gateway service. This is a
 * shared HS256 secret across every AIDEN hub app.
 */
export async function verifyGatewayJWT(
  token: string
): Promise<GatewayJWTPayload | null> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: 'aiden-gateway',
    });
    if (!payload.sub || !payload.email) return null;
    return payload as GatewayJWTPayload;
  } catch {
    return null;
  }
}
