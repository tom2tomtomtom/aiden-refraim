/**
 * Billing path resolution — exactly ONE entitlement path per export.
 *
 * UXA-20260717 F-010: an export must never draw down both the plan
 * allowance and Gateway tokens. Resolution order:
 *
 *   1. Any remaining plan allowance (free tier's 3/mo or a paid plan's
 *      quota) is the billing path — no tokens are touched. Free means free.
 *   2. A free-tier user whose allowance is exhausted falls back to Gateway
 *      tokens (2 per export) when the service key is configured, instead of
 *      being hard-blocked into an upgrade.
 *   3. Otherwise the export is blocked (paid plan cap hit, or free cap hit
 *      with no token path available).
 */

export type BillingPath = 'plan_quota' | 'gateway_tokens' | 'blocked';

export function resolveBillingPath(
  plan: string,
  allowanceRemaining: number,
  serviceKeyConfigured: boolean,
): BillingPath {
  if (allowanceRemaining > 0) return 'plan_quota';
  if (plan === 'free' && serviceKeyConfigured) return 'gateway_tokens';
  return 'blocked';
}
