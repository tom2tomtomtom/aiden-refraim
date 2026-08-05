import express from 'express';
import request from 'supertest';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * The real app pulls in Supabase, Stripe, Sentry and the reaper, none of which
 * this is about. What is being tested is the proxy/keying configuration, so
 * that is reproduced here exactly as app.ts sets it.
 */
function buildApp(trustProxyHops: number | boolean) {
  const app = express();
  app.set('trust proxy', trustProxyHops);

  const limiter = rateLimit({
    windowMs: 60_000,
    max: 2,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: express.Request) => ipKeyGenerator(req.ip ?? '', 56),
    message: { error: 'Too many requests, please try again later' },
  });

  app.use('/api', limiter);
  app.get('/api/thing', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function get(app: express.Express, forwardedFor: string) {
  return request(app).get('/api/thing').set('X-Forwarded-For', forwardedFor);
}

describe('rate limiter proxy configuration', () => {
  it('gives each client its own bucket behind one proxy hop', async () => {
    const app = buildApp(1);

    // Client A exhausts its own allowance.
    expect((await get(app, '203.0.113.10')).status).toBe(200);
    expect((await get(app, '203.0.113.10')).status).toBe(200);
    expect((await get(app, '203.0.113.10')).status).toBe(429);

    // Client B is unaffected. Before trust proxy was set, every client shared
    // the proxy's address and this would already be 429.
    expect((await get(app, '198.51.100.7')).status).toBe(200);
  });

  it('shares a bucket across every client when trust proxy is left unset', async () => {
    const app = buildApp(false);

    expect((await get(app, '203.0.113.10')).status).toBe(200);
    expect((await get(app, '198.51.100.7')).status).toBe(200);
    // Two different clients, one exhausted bucket: the defect F-50 describes.
    expect((await get(app, '192.0.2.44')).status).toBe(429);
  });

  it('does not let a client mint buckets by forging the forwarded chain', async () => {
    const app = buildApp(1);

    // Only the last hop is trusted, so the entries the client prepended are
    // ignored and all three requests land in the same bucket.
    expect((await get(app, '1.1.1.1, 203.0.113.10')).status).toBe(200);
    expect((await get(app, '2.2.2.2, 203.0.113.10')).status).toBe(200);
    expect((await get(app, '3.3.3.3, 203.0.113.10')).status).toBe(429);
  });

  it('collapses an IPv6 allocation so it cannot spread across addresses', async () => {
    const app = buildApp(1);

    expect((await get(app, '2001:db8:abcd:0100::1')).status).toBe(200);
    expect((await get(app, '2001:db8:abcd:0100::2')).status).toBe(200);
    // Same /56, so the third address in it is refused rather than granted a
    // fresh allowance.
    expect((await get(app, '2001:db8:abcd:0100::3')).status).toBe(429);
  });
});
