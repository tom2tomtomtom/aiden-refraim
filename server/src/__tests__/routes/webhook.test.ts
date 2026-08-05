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

/**
 * Stand-in for refraim.stripe_webhook_events, enforcing the primary key the
 * real table enforces so a redelivered event id loses the insert.
 */
function createEventLedger() {
  const claimed = new Set<string>();
  const insert = jest.fn(async (row: any) => {
    if (claimed.has(row.event_id)) {
      return { data: null, error: { code: '23505', message: 'duplicate key' } };
    }
    claimed.add(row.event_id);
    return { data: null, error: null };
  });
  const eq = jest.fn(async (_col: string, value: string) => {
    claimed.delete(value);
    return { data: null, error: null };
  });
  return {
    claimed,
    insert,
    deleteEq: eq,
    handle: { insert, delete: jest.fn().mockReturnValue({ eq }) },
  };
}

/** Route `supabase.from()` by table so the ledger and user_billing don't collide. */
function routeTables(ledger: ReturnType<typeof createEventLedger>, billing: any) {
  mockFrom.mockImplementation((table: string) =>
    table === 'stripe_webhook_events' ? ledger.handle : billing,
  );
}

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
    routeTables(createEventLedger(), { upsert: mockUpsert });

    mockConstructEvent.mockReturnValue({
      id: 'evt_checkout_1',
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
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-abc',
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: 'sub_456',
      stripe_price_id: 'price_pro',
      subscription_status: 'active',
      plan: 'pro',
      exports_this_month: 0,
      // exports_reset_at is an ISO timestamp generated at upsert time;
      // assert it's present without pinning the exact millisecond.
      exports_reset_at: expect.any(String),
    }));
  });

  it('handles customer.subscription.deleted event', async () => {
    const mockEq = jest.fn().mockResolvedValue({ data: null, error: null });
    const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });
    routeTables(createEventLedger(), { update: mockUpdate });

    mockConstructEvent.mockReturnValue({
      id: 'evt_deleted_1',
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

  describe('idempotency', () => {
    function checkoutEvent(id: string) {
      return {
        id,
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { supabase_user_id: 'user-abc', plan: 'pro' },
            customer: 'cus_123',
            subscription: 'sub_456',
          },
        },
      };
    }

    function post(app: express.Express) {
      return request(app)
        .post('/webhook/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid_sig')
        .send('{}');
    }

    beforeEach(() => {
      mockSubscriptionsRetrieve.mockResolvedValue({
        items: { data: [{ price: { id: 'price_pro' } }] },
      });
    });

    it('does not reset the export counter on a redelivered event', async () => {
      const mockUpsert = jest.fn().mockResolvedValue({ data: null, error: null });
      routeTables(createEventLedger(), { upsert: mockUpsert });
      mockConstructEvent.mockReturnValue(checkoutEvent('evt_same'));

      const app = buildApp();
      const first = await post(app);
      const second = await post(app);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ received: true, duplicate: true });
      // The whole point: exports_this_month = 0 was written once, not twice.
      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });

    it('still applies a genuinely different event', async () => {
      const mockUpsert = jest.fn().mockResolvedValue({ data: null, error: null });
      routeTables(createEventLedger(), { upsert: mockUpsert });

      const app = buildApp();
      mockConstructEvent.mockReturnValue(checkoutEvent('evt_one'));
      await post(app);
      mockConstructEvent.mockReturnValue(checkoutEvent('evt_two'));
      await post(app);

      expect(mockUpsert).toHaveBeenCalledTimes(2);
    });

    it('releases the claim when the handler throws, so Stripe can retry', async () => {
      const ledger = createEventLedger();
      const mockUpsert = jest
        .fn()
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue({ data: null, error: null });
      routeTables(ledger, { upsert: mockUpsert });
      mockConstructEvent.mockReturnValue(checkoutEvent('evt_flaky'));

      const app = buildApp();
      const failed = await post(app);
      expect(failed.status).toBe(500);
      expect(ledger.claimed.has('evt_flaky')).toBe(false);

      const retried = await post(app);
      expect(retried.status).toBe(200);
      expect(retried.body).toEqual({ received: true });
      expect(mockUpsert).toHaveBeenCalledTimes(2);
    });

    it('refuses the event when the ledger itself is unreachable', async () => {
      const mockUpsert = jest.fn().mockResolvedValue({ data: null, error: null });
      const brokenLedger = {
        insert: jest.fn().mockResolvedValue({ data: null, error: { code: '08006' } }),
        delete: jest.fn(),
      };
      mockFrom.mockImplementation((table: string) =>
        table === 'stripe_webhook_events' ? brokenLedger : { upsert: mockUpsert },
      );
      mockConstructEvent.mockReturnValue(checkoutEvent('evt_no_ledger'));

      const res = await post(buildApp());

      // No replay protection means no handling: a 500 makes Stripe retry.
      expect(res.status).toBe(500);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });
});
