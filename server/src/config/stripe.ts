import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('STRIPE_SECRET_KEY not set. Billing features will be unavailable.');
}

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    priceId: null,
    exportsPerMonth: 3,
  },
  starter: {
    name: 'Starter',
    price: 2900,
    priceId: process.env.STRIPE_PRICE_ID_STARTER || '',
    exportsPerMonth: 50,
  },
  pro: {
    name: 'Pro',
    price: 7900,
    priceId: process.env.STRIPE_PRICE_ID_PRO || '',
    exportsPerMonth: -1, // unlimited
  },
  agency: {
    name: 'Agency',
    price: 19900,
    priceId: process.env.STRIPE_PRICE_ID_AGENCY || '',
    exportsPerMonth: -1, // unlimited
  },
} as const;
