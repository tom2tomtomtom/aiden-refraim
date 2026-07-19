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

function currentPeriodView(row: BillingRow): BillingRow {
  if (!isStale(row.exports_reset_at)) return row;
  const nowIso = new Date().toISOString();
  // This is a read-only projection for plan display/routing. The reservation
  // RPC owns the durable rollover while holding the billing row lock, so a
  // delayed status read can never erase another request's increment.
  return { ...row, exports_this_month: 0, exports_reset_at: nowIso };
}

export async function getQuotaState(userId: string): Promise<QuotaState> {
  const row = currentPeriodView(await ensureBillingRow(userId));
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

type ReservationRpcResult = {
  reserved?: boolean;
  used?: number;
  resets_at?: string;
};

type RecoveryRpcResult = {
  recovered?: boolean;
  refunded?: boolean;
};

function rpcResult<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/**
 * Atomically reserve one plan slot and advance the durable job from
 * `reserving_plan_quota` to `processing_plan_quota`. The job id is the
 * idempotency key, so replaying after a lost response cannot consume twice.
 */
export async function reserveExportForJob(
  userId: string,
  jobId: string,
  state: QuotaState,
): Promise<QuotaState | null> {
  const { data, error } = await supabase.rpc('reserve_refraim_export', {
    p_job_id: jobId,
    p_user_id: userId,
    p_limit: state.limit,
  });
  if (error) throw error;

  const result = rpcResult(data as ReservationRpcResult | ReservationRpcResult[] | null);
  if (!result?.reserved) return null;
  const used = Number.isFinite(result.used) ? Number(result.used) : state.used + 1;
  return {
    ...state,
    used,
    resetsAt: typeof result.resets_at === 'string' ? result.resets_at : state.resetsAt,
    remaining: state.limit === -1
      ? Number.POSITIVE_INFINITY
      : Math.max(0, state.limit - used),
  };
}

/**
 * Atomically fence publication, refund a reserved allowance at most once,
 * release the video claim, and finalize the job. Legacy missing-job claims
 * are materialized under their active job id so retries are also idempotent.
 */
export async function recoverPlanQuotaExport(
  userId: string,
  videoId: string,
  jobId: string,
  legacyMissingJob = false,
): Promise<{ recovered: boolean; refunded: boolean }> {
  const { data, error } = await supabase.rpc('recover_refraim_plan_quota_export', {
    p_user_id: userId,
    p_video_id: videoId,
    p_job_id: jobId,
    p_legacy_missing_job: legacyMissingJob,
  });
  if (error) throw error;

  const result = rpcResult(data as RecoveryRpcResult | RecoveryRpcResult[] | null);
  return {
    recovered: Boolean(result?.recovered),
    refunded: Boolean(result?.refunded),
  };
}
