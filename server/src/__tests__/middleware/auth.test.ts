import { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';

const mockGetUser = jest.fn();

jest.mock('../../config/supabase', () => ({
  authClient: {
    auth: {
      getUser: (...args: any[]) => mockGetUser(...args),
    },
  },
  supabase: {},
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

  it('returns 401 when no Authorization header', async () => {
    const { req, res, next } = buildReqResNext();
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header has no Bearer prefix', async () => {
    const { req, res, next } = buildReqResNext({ authorization: 'Basic abc123' });
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({ error: 'No token provided' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is empty after Bearer', async () => {
    const { req, res, next } = buildReqResNext({ authorization: 'Bearer ' });
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and sets req.user when token is valid', async () => {
    const fakeUser = { id: 'user-123', email: 'test@example.com', aud: 'authenticated' };
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });

    const { req, res, next } = buildReqResNext({ authorization: 'Bearer valid-token' });
    await requireAuth(req, res, next);

    expect(mockGetUser).toHaveBeenCalledWith('valid-token');
    expect((req as any).user).toEqual(fakeUser);
    expect(next).toHaveBeenCalled();
    expect((res.status as jest.Mock)).not.toHaveBeenCalled();
  });

  it('returns 401 when supabase.auth.getUser returns error', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Token expired' },
    });

    const { req, res, next } = buildReqResNext({ authorization: 'Bearer expired-token' });
    await requireAuth(req, res, next);

    expect((res.status as jest.Mock)).toHaveBeenCalledWith(401);
    expect((res.json as jest.Mock)).toHaveBeenCalledWith({
      error: 'Invalid JWT',
      details: 'Token expired',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
