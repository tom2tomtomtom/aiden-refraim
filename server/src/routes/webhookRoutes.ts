import { Router, Request, Response } from 'express';
import { stripe } from '../config/stripe';
import { supabase } from '../config/supabase';
import express from 'express';

const router = Router();

// Stripe webhook (needs raw body, not parsed JSON)
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    if (!stripe) {
      res.status(503).json({ error: 'Billing not configured' });
      return;
    }

    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      res.status(400).json({ error: 'Missing signature or webhook secret' });
      return;
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          const userId = session.metadata?.supabase_user_id;
          const plan = session.metadata?.plan;
          if (userId && session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            const priceId = sub.items.data[0]?.price?.id;
            await supabase.from('user_billing').upsert({
              user_id: userId,
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
              stripe_price_id: priceId,
              subscription_status: 'active',
              plan: plan || 'starter',
            });
          }
          break;
        }

        case 'customer.subscription.updated': {
          const sub = event.data.object as any;
          const priceId = sub.items?.data?.[0]?.price?.id;
          await supabase
            .from('user_billing')
            .update({
              subscription_status: sub.status,
              stripe_price_id: priceId,
            })
            .eq('stripe_subscription_id', sub.id);
          break;
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object as any;
          await supabase
            .from('user_billing')
            .update({
              subscription_status: 'cancelled',
              stripe_price_id: null,
              plan: 'free',
            })
            .eq('stripe_subscription_id', sub.id);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          if (invoice.subscription) {
            await supabase
              .from('user_billing')
              .update({ subscription_status: 'past_due' })
              .eq('stripe_subscription_id', invoice.subscription);
          }
          break;
        }
      }

      res.json({ received: true });
      return;
    } catch (error) {
      console.error('Webhook handler error:', error);
      res.status(500).json({ error: 'Webhook handler failed' });
      return;
    }
  }
);

export default router;
