import { Router, Request, Response } from 'express';
import { stripe } from '../config/stripe';
import { supabase } from '../config/supabase';
import express from 'express';

const router = Router();

const UNIQUE_VIOLATION = '23505';

type StripeEventClaim = 'claimed' | 'duplicate' | 'unavailable';

/**
 * Record that this event id is being handled. The primary key does the work:
 * a second delivery of the same event loses the insert race and is told so,
 * whether it arrives a second or a week later.
 */
async function claimStripeEvent(eventId: string, eventType: string): Promise<StripeEventClaim> {
  try {
    const { error } = await supabase
      .from('stripe_webhook_events')
      .insert({ event_id: eventId, event_type: eventType });

    if (!error) return 'claimed';
    if (error.code === UNIQUE_VIOLATION) return 'duplicate';

    console.error('Failed to claim Stripe event:', error);
    return 'unavailable';
  } catch (err) {
    console.error('Failed to claim Stripe event:', err);
    return 'unavailable';
  }
}

async function releaseStripeEvent(eventId: string): Promise<void> {
  try {
    await supabase.from('stripe_webhook_events').delete().eq('event_id', eventId);
  } catch (err) {
    // The event stays claimed and Stripe's retry will be treated as a
    // duplicate. Loud, because it needs a manual replay to resolve.
    console.error(`Failed to release Stripe event ${eventId}; it will not be retried:`, err);
  }
}

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

    // Claim the event id before doing anything with it. Stripe delivers at
    // least once, and checkout.session.completed zeroes the export counter, so
    // an unguarded redelivery is a free month.
    const claim = await claimStripeEvent(event.id, event.type);
    if (claim === 'duplicate') {
      res.json({ received: true, duplicate: true });
      return;
    }
    if (claim === 'unavailable') {
      // Without the ledger there is no replay protection, and a 500 makes
      // Stripe retry once the ledger is reachable again.
      console.error('Webhook idempotency ledger unavailable; refusing the event');
      res.status(500).json({ error: 'Webhook handler failed' });
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
              // Upgrading / renewing a subscription resets the monthly
              // export counter so the user doesn't carry over free-tier
              // usage into their new plan's billing cycle.
              exports_this_month: 0,
              exports_reset_at: new Date().toISOString(),
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
      // The claim is a claim, not a receipt. Releasing it keeps Stripe's retry
      // able to apply the event; leaving it would make one transient failure
      // permanent.
      await releaseStripeEvent(event.id);
      res.status(500).json({ error: 'Webhook handler failed' });
      return;
    }
  }
);

export default router;
