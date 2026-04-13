import express from 'express';
import request from 'supertest';

const mockConstructEvent = jest.fn();
const mockSubscriptionsRetrieve = jest.fn();
const mockFrom = jest.fn();

let mockStripe: any = null;

jest.mock('../../config/stripe', () => ({
  get stripe() {
    return mockStripe;
  },
}));

jest.mock('../../config/supabase', () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

import webhookRoutes from '../../routes/webhookRoutes';

function buildApp() {
  const app = express();
  // Webhook route handles its own body parsing (express.raw), so no app-level json parser
  app.use('/webhook', webhookRoutes);
  return app;
}

describe('webhook routes', () => {
  const WEBHOOK_SECRET = 'whsec_test123';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    mockStripe = {
      webhooks: { constructEvent: mockConstructEvent },
      subscriptions: { retrieve: mockSubscriptionsRetrieve },
    };
  });

  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('returns 503 when stripe not configured', async () => {
    mockStripe = null;

    const app = buildApp();
    const res = await request(app)
      .post('/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'sig_test')
      .send('{}');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Billing not configured');
  });

  it('returns 400 when no stripe-signature header', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/webhook/stripe')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing signature or webhook secret');
  });

  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Signature mismatch');
    });

    const app = buildApp();
    const res = await request(app)
      .post('/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'bad_sig')
      .send('{}');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('handles checkout.session.completed event', async () => {
    const mockUpsert = jest.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: { supabase_user_id: 'user-abc', plan: 'pro' },
          customer: 'cus_123',
          subscription: 'sub_456',
        },
      },
    });

    mockSubscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ price: { id: 'price_pro' } }] },
    });

    const app = buildApp();
    const res = await request(app)
      .post('/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send('{}');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_456');
    expect(mockFrom).toHaveBeenCalledWith('user_billing');
    expect(mockUpsert).toHaveBeenCalledWith({
      user_id: 'user-abc',
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_456',
      stripe_price_id: 'price_pro',
      subscription_status: 'active',
      plan: 'pro',
    });
  });

  it('handles customer.subscription.deleted event', async () => {
    const mockEq = jest.fn().mockResolvedValue({ data: null, error: null });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });

    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: {
        object: { id: 'sub_789' },
      },
    });

    const app = buildApp();
    const res = await request(app)
      .post('/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid_sig')
      .send('{}');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    expect(mockFrom).toHaveBeenCalledWith('user_billing');
    expect(mockUpdate).toHaveBeenCalledWith({
      subscription_status: 'cancelled',
      stripe_price_id: null,
      plan: 'free',
    });
    expect(mockEq).toHaveBeenCalledWith('stripe_subscription_id', 'sub_789');
  });
});
