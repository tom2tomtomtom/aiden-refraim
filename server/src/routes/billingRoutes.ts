import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { stripe, PLANS } from '../config/stripe';
import { supabase } from '../config/supabase';

const router = Router();

// Get current plan
router.get('/plan', requireAuth as any, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const { data: user } = await supabase
      .from('user_billing')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!user) {
      return res.json({ plan: 'free', exports_this_month: 0, exports_limit: PLANS.free.exportsPerMonth });
    }

    const plan = Object.entries(PLANS).find(([, p]) => p.priceId === user.stripe_price_id)?.[0] || 'free';
    const planConfig = PLANS[plan as keyof typeof PLANS] || PLANS.free;

    return res.json({
      plan,
      exports_this_month: user.exports_this_month || 0,
      exports_limit: planConfig.exportsPerMonth,
      stripe_customer_id: user.stripe_customer_id,
      subscription_status: user.subscription_status,
    });
  } catch (error) {
    console.error('Error getting plan:', error);
    return res.status(500).json({ error: 'Failed to get plan' });
  }
});

// Create checkout session
router.post('/checkout', requireAuth as any, async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Billing not configured' });
  }

  try {
    const userId = (req as any).user.id;
    const userEmail = (req as any).user.email;
    const { plan } = req.body;

    const planConfig = PLANS[plan as keyof typeof PLANS];
    if (!planConfig || !planConfig.priceId) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Get or create Stripe customer
    let { data: billing } = await supabase
      .from('user_billing')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    let customerId = billing?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;

      await supabase
        .from('user_billing')
        .upsert({ user_id: userId, stripe_customer_id: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/?billing=success`,
      cancel_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/?billing=cancelled`,
      metadata: { supabase_user_id: userId, plan },
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Create customer portal session
router.post('/portal', requireAuth as any, async (req: Request, res: Response) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Billing not configured' });
  }

  try {
    const userId = (req as any).user.id;

    const { data: billing } = await supabase
      .from('user_billing')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single();

    if (!billing?.stripe_customer_id) {
      return res.status(404).json({ error: 'No billing account found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/`,
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating portal:', error);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// Get plans
router.get('/plans', (_req: Request, res: Response) => {
  return res.json({
    plans: Object.entries(PLANS).map(([key, plan]) => ({
      id: key,
      name: plan.name,
      price: plan.price,
      exports_per_month: plan.exportsPerMonth,
    })),
  });
});

export default router;
