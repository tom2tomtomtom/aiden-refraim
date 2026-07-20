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
    cookie: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

function gatewayResponse(status: number, body: Record<string, unknown> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as globalThis.Response;
}

describe('requireAuth middleware', () => {
  const originalFetch = global.fetch;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockVerify.mockReset();
    global.fetch = jest.fn();
    process.env.NODE_ENV = originalNodeEnv;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env.NODE_ENV = originalNodeEnv;
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

  it('uses a valid access cookie without calling the durable-session endpoint', async () => {
    mockVerify.mockResolvedValue({
      sub: 'current-user',
      email: 'current@example.com',
      iss: 'aiden-gateway',
    });

    const { req, res, next } = buildReqResNext({
      cookie: 'aiden-gw=current-access; aiden-gw-rt=durable-token',
    });
    await requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith('current-access');
    expect(global.fetch).not.toHaveBeenCalled();
    expect((res.cookie as jest.Mock)).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
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

  it('recovers an RT-only request and trusts the locally verified current identity', async () => {
    process.env.NODE_ENV = 'production';
    (global.fetch as jest.Mock).mockResolvedValue(gatewayResponse(200, {
      jwt: 'fresh-access',
      user: { id: 'untrusted-user', email: 'untrusted@example.com' },
    }));
    mockVerify.mockResolvedValue({
      sub: 'current-user',
      email: 'current@example.com',
      iss: 'aiden-gateway',
    });

    const { req, res, next } = buildReqResNext({
      cookie: 'tracking=do-not-forward; aiden-gw-rt=durable-token',
    });
    await requireAuth(req, res, next);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.aiden.services/api/auth/access',
      {
        method: 'POST',
        headers: { Cookie: 'aiden-gw-rt=durable-token' },
        cache: 'no-store',
      },
    );
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith('fresh-access');
    expect((req as any).user).toEqual({
      id: 'current-user',
      email: 'current@example.com',
      aud: 'authenticated',
    });
    expect((res.cookie as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((res.cookie as jest.Mock)).toHaveBeenCalledWith('aiden-gw', 'fresh-access', {
      httpOnly: true,
      secure: true,
      domain: '.aiden.services',
      path: '/',
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000,
    });
    expect((res.cookie as jest.Mock).mock.calls.flat()).not.toContain('aiden-gw-rt');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('recovers after an invalid access cookie using the durable cookie', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(gatewayResponse(200, {
      jwt: 'fresh-access',
      user: { id: 'current-user', email: 'current@example.com' },
    }));
    mockVerify
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        sub: 'current-user',
        email: 'current@example.com',
        iss: 'aiden-gateway',
      });

    const { req, res, next } = buildReqResNext({
      cookie: 'aiden-gw=expired-access; aiden-gw-rt=durable-token',
    });
    await requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenNthCalledWith(1, 'expired-access');
    expect(mockVerify).toHaveBeenNthCalledWith(2, 'fresh-access');
    expect((res.cookie as jest.Mock)).toHaveBeenCalledWith(
      'aiden-gw',
      'fresh-access',
      expect.any(Object),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the durable token is rejected', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(gatewayResponse(401, {
      error: 'Unauthorized',
    }));

    const { req, res, next } = buildReqResNext({
      cookie: 'aiden-gw-rt=invalid-durable-token',
    });
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.cookie as jest.Mock)).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed when the Gateway returns an invalid minted JWT', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(gatewayResponse(200, {
      jwt: 'invalid-minted-access',
      user: { id: 'untrusted-user', email: 'untrusted@example.com' },
    }));
    mockVerify.mockResolvedValue(null);

    const { req, res, next } = buildReqResNext({
      cookie: 'aiden-gw-rt=durable-token',
    });
    await requireAuth(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('invalid-minted-access');
    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.cookie as jest.Mock)).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['Gateway error response', () => Promise.resolve(gatewayResponse(503, {
      error: 'Auth unavailable',
    }))],
    ['network failure', () => Promise.reject(new Error('connection failed'))],
  ])('fails closed during a %s', async (_label, fetchResult) => {
    (global.fetch as jest.Mock).mockImplementation(fetchResult);

    const { req, res, next } = buildReqResNext({
      cookie: 'aiden-gw-rt=durable-token',
    });
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(503);
    expect((res.cookie as jest.Mock)).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
