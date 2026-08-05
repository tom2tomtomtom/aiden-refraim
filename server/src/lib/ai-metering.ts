/**
 * Token metering for the two synchronous paid-provider routes.
 *
 * These call Claude directly (`aiEditorService`), which the export path never
 * does — exports spend Railway compute, these spend Anthropic credit. They had
 * no token check and no deduction of any kind.
 *
 * refrAIm never names a price here, exactly as it doesn't for exports: Gateway
 * owns the cost of each operation and reports it back through `checkTokens`.
 *
 * Three states, and the middle one is the point:
 *
 * - No `ANTHROPIC_API_KEY`: nothing paid can happen, the service falls back to
 *   its rule-based strategy, and there is nothing to charge for.
 * - `ANTHROPIC_API_KEY` but no `AIDEN_SERVICE_KEY`: the provider would bill us
 *   with no way to bill anyone back. Fail closed — take the free fallback
 *   rather than spending silently.
 * - Both: check before, deduct after, and only when the call succeeded.
 */

import { randomUUID } from 'node:crypto';
import { checkTokens, deductTokens } from './gateway-tokens';

export type AiOperation = 'ai_focus_strategy' | 'crop_review';

export type AiSpendDecision =
  | { paid: true; requestId: string }
  | { paid: false; reason: 'no_provider_key' | 'no_service_key' }
  | { paid: false; reason: 'insufficient_tokens'; required: number; balance: number };

/** Resolve whether this request may spend, before any provider call is made. */
export async function authorizeAiSpend(
  userId: string,
  operation: AiOperation,
): Promise<AiSpendDecision> {
  if (!process.env.ANTHROPIC_API_KEY) return { paid: false, reason: 'no_provider_key' };
  if (!process.env.AIDEN_SERVICE_KEY) {
    console.warn(
      `[ai-metering] ${operation} cannot be metered without AIDEN_SERVICE_KEY; using the free path`,
    );
    return { paid: false, reason: 'no_service_key' };
  }

  const check = await checkTokens(userId, 'refraim', operation);
  if (!check.allowed) {
    return {
      paid: false,
      reason: 'insufficient_tokens',
      required: check.required,
      balance: check.balance,
    };
  }
  return { paid: true, requestId: randomUUID() };
}

/**
 * Settle after the provider returned. The request id makes this idempotent at
 * Gateway, so a retried settlement creates at most one deduction.
 */
export async function settleAiSpend(
  userId: string,
  operation: AiOperation,
  requestId: string,
): Promise<boolean> {
  const deduction = await deductTokens(userId, 'refraim', operation, requestId);
  if (!deduction.success) {
    console.error(`[ai-metering] ${operation} settlement failed:`, deduction.error);
    return false;
  }
  return true;
}
