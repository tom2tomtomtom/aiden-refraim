import { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';

const mockVerify = jest.fn();

jest.mock('../../lib/gateway-jwt', () => ({
  GW_COOKIE_NAME: 'aiden-gw',
  verifyGatewayJWT: (...args: unknown[]) => mockVerify(...args),
}));

function buildReqResNext(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('requireAuth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when no cookie or Authorization header', async () => {
    const { req, res, next } = buildReqResNext();
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is non-Bearer and no cookie', async () => {
    const { req, res, next } = buildReqResNext({ authorization: 'Basic abc123' });
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('authenticates via Bearer header', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-123',
      email: 'test@example.com',
      iss: 'aiden-gateway',
    });

    const { req, res, next } = buildReqResNext({ authorization: 'Bearer valid-token' });
    await requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('valid-token');
    expect((req as any).user).toEqual({
      id: 'user-123',
      email: 'test@example.com',
      aud: 'authenticated',
    });
    expect(next).toHaveBeenCalled();
    expect((res.status as jest.Mock)).not.toHaveBeenCalled();
  });

  it('authenticates via aiden-gw cookie', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-456',
      email: 'cookie@example.com',
      iss: 'aiden-gateway',
    });

    const { req, res, next } = buildReqResNext({
      cookie: 'other=xyz; aiden-gw=cookie-token; last=end',
    });
    await requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('cookie-token');
    expect((req as any).user.id).toBe('user-456');
    expect(next).toHaveBeenCalled();
  });

  it('prefers cookie over Bearer header when both present', async () => {
    mockVerify.mockResolvedValue({
      sub: 'user-from-cookie',
      email: 'cookie@example.com',
      iss: 'aiden-gateway',
    });

    const { req, res, next } = buildReqResNext({
      authorization: 'Bearer header-token',
      cookie: 'aiden-gw=cookie-token',
    });
    await requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('cookie-token');
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when verifyGatewayJWT returns null', async () => {
    mockVerify.mockResolvedValue(null);

    const { req, res, next } = buildReqResNext({ authorization: 'Bearer expired' });
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      error: 'Invalid or expired token',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
