import express from 'express';
import request from 'supertest';

// Mock auth middleware to either block or pass through
const mockRequireAuth = jest.fn();

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => mockRequireAuth(req, res, next),
}));

jest.mock('../../config/supabase', () => ({
  authClient: { auth: { getUser: jest.fn() } },
  supabase: {
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}));

// stripe mock: null by default (not configured)
let mockStripe: any = null;

jest.mock('../../config/stripe', () => {
  const actual = jest.requireActual('../../config/stripe');
  return {
    get stripe() {
      return mockStripe;
    },
    PLANS: actual.PLANS,
  };
});

import billingRoutes from '../../routes/billingRoutes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/billing', billingRoutes);
  return app;
}

describe('billing routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStripe = null;
  });

  describe('GET /billing/plans', () => {
    it('returns all 4 plans with correct prices', async () => {
      const app = buildApp();
      const res = await request(app).get('/billing/plans');

      expect(res.status).toBe(200);
      expect(res.body.plans).toHaveLength(4);

      const ids = res.body.plans.map((p: any) => p.id);
      expect(ids).toEqual(['free', 'starter', 'pro', 'agency']);

      const free = res.body.plans.find((p: any) => p.id === 'free');
      expect(free.price).toBe(0);

      const starter = res.body.plans.find((p: any) => p.id === 'starter');
      expect(starter.price).toBe(2900);

      const pro = res.body.plans.find((p: any) => p.id === 'pro');
      expect(pro.price).toBe(7900);

      const agency = res.body.plans.find((p: any) => p.id === 'agency');
      expect(agency.price).toBe(19900);
    });
  });

  describe('GET /billing/plan', () => {
    it('returns 401 without auth', async () => {
      mockRequireAuth.mockImplementation((_req: any, res: any) => {
        return res.status(401).json({ error: 'No token provided' });
      });

      const app = buildApp();
      const res = await request(app).get('/billing/plan');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /billing/checkout', () => {
    it('returns 400 for invalid plan', async () => {
      mockRequireAuth.mockImplementation((req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', email: 'test@example.com' };
        next();
      });
      mockStripe = {}; // configured but won't be used

      const app = buildApp();
      const res = await request(app)
        .post('/billing/checkout')
        .send({ plan: 'nonexistent' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid plan');
    });

    it('returns 400 for free plan (no priceId)', async () => {
      mockRequireAuth.mockImplementation((req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', email: 'test@example.com' };
        next();
      });
      mockStripe = {};

      const app = buildApp();
      const res = await request(app)
        .post('/billing/checkout')
        .send({ plan: 'free' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid plan');
    });

    it('returns 503 when stripe is not configured', async () => {
      mockRequireAuth.mockImplementation((req: any, _res: any, next: any) => {
        req.user = { id: 'user-1', email: 'test@example.com' };
        next();
      });
      mockStripe = null;

      const app = buildApp();
      const res = await request(app)
        .post('/billing/checkout')
        .send({ plan: 'starter' });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Billing not configured');
    });
  });
});
