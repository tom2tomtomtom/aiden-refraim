/**
 * Free-tier / subscription export quota enforcement.
 *
 * Backs the per-user monthly export cap defined in config/stripe.ts
 * `PLANS[*].exportsPerMonth`. `-1` means unlimited.
 *
 * The schema has `user_billing.exports_this_month` and
 * `user_billing.exports_reset_at` columns already; this module is the
 * only thing that should mutate them on the happy path (Stripe webhook
 * subscription events aside).
 */

import { supabase } from '../config/supabase';
import { PLANS } from '../config/stripe';

const RESET_INTERVAL_DAYS = 30;

export interface QuotaState {
  plan: keyof typeof PLANS;
  used: number;
  limit: number; // -1 = unlimited
  remaining: number; // Number.POSITIVE_INFINITY for unlimited
  resetsAt: string; // ISO timestamp
}

interface BillingRow {
  user_id: string;
  stripe_price_id: string | null;
  exports_this_month: number;
  exports_reset_at: string | null;
}

function resolvePlanKey(priceId: string | null | undefined): keyof typeof PLANS {
  if (!priceId) return 'free';
  const entry = Object.entries(PLANS).find(([, p]) => p.priceId === priceId);
  return (entry?.[0] as keyof typeof PLANS) || 'free';
}

function isStale(resetAt: string | null | undefined): boolean {
  if (!resetAt) return true;
  const resetDate = new Date(resetAt);
  if (Number.isNaN(resetDate.getTime())) return true;
  const cutoff = Date.now() - RESET_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  return resetDate.getTime() < cutoff;
}

async function ensureBillingRow(userId: string): Promise<BillingRow> {
  const { data } = await supabase
    .from('user_billing')
    .select('user_id, stripe_price_id, exports_this_month, exports_reset_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (data) return data as BillingRow;

  const nowIso = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from('user_billing')
    .insert({
      user_id: userId,
      plan: 'free',
      subscription_status: 'inactive',
      exports_this_month: 0,
      exports_reset_at: nowIso,
    })
    .select('user_id, stripe_price_id, exports_this_month, exports_reset_at')
    .single();

  if (error) {
    // Under a race with another insert the unique constraint will fire; fall back to re-read.
    const { data: retry } = await supabase
      .from('user_billing')
      .select('user_id, stripe_price_id, exports_this_month, exports_reset_at')
      .eq('user_id', userId)
      .single();
    if (retry) return retry as BillingRow;
    throw error;
  }
  return inserted as BillingRow;
}

async function maybeResetMonth(row: BillingRow): Promise<BillingRow> {
  if (!isStale(row.exports_reset_at)) return row;
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('user_billing')
    .update({ exports_this_month: 0, exports_reset_at: nowIso, updated_at: nowIso })
    .eq('user_id', row.user_id)
    .select('user_id, stripe_price_id, exports_this_month, exports_reset_at')
    .single();
  return (data as BillingRow) ?? { ...row, exports_this_month: 0, exports_reset_at: nowIso };
}

export async function getQuotaState(userId: string): Promise<QuotaState> {
  const row = await maybeResetMonth(await ensureBillingRow(userId));
  const plan = resolvePlanKey(row.stripe_price_id);
  const limit = PLANS[plan].exportsPerMonth;
  const used = row.exports_this_month ?? 0;
  return {
    plan,
    used,
    limit,
    remaining: limit === -1 ? Number.POSITIVE_INFINITY : Math.max(0, limit - used),
    resetsAt: row.exports_reset_at ?? new Date().toISOString(),
  };
}

/**
 * Reserve one export slot atomically if the user has quota. Returns the
 * post-increment state on success, or `null` when the cap is hit.
 *
 * Not fully race-safe (two concurrent calls could each pass the read
 * check), but sufficient for a free-tier gate — a single user rapid-firing
 * exports might slip by 1 over the cap, which is well under the tolerance
 * we need. Use a Postgres RPC (SELECT ... FOR UPDATE, or a SECURITY DEFINER
 * function) if this becomes a billing integrity concern.
 */
export async function reserveExport(userId: string): Promise<QuotaState | null> {
  const state = await getQuotaState(userId);
  if (state.limit !== -1 && state.used >= state.limit) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const nextUsed = state.used + 1;
  const { error } = await supabase
    .from('user_billing')
    .update({ exports_this_month: nextUsed, updated_at: nowIso })
    .eq('user_id', userId);
  if (error) throw error;

  return {
    ...state,
    used: nextUsed,
    remaining: state.limit === -1 ? Number.POSITIVE_INFINITY : Math.max(0, state.limit - nextUsed),
  };
}

/**
 * Credit one export slot back to the user. Call this if the job fails in a
 * way where the user shouldn't have been charged (hard crash, platform
 * rejected invalid input, etc.). No-op if balance would go negative.
 */
export async function refundExport(userId: string): Promise<void> {
  const { data } = await supabase
    .from('user_billing')
    .select('exports_this_month')
    .eq('user_id', userId)
    .maybeSingle();
  const current = data?.exports_this_month ?? 0;
  if (current <= 0) return;
  await supabase
    .from('user_billing')
    .update({ exports_this_month: current - 1, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}
