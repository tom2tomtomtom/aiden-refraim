/**
 * Gateway Token Client
 *
 * Calls the AIDEN Gateway token API for balance checks and deductions.
 * Uses X-Service-Key + X-User-Id headers for server-to-server auth.
 *
 * Fail-closed: if Gateway is unreachable, both checkTokens and deductTokens
 * deny the operation. Gateway token deductions apply to free users only when
 * AIDEN_SERVICE_KEY is set. Paid Stripe subscribers use their plan quota and
 * skip the Gateway deduction. Silently skipping a free-user deduction on an
 * outage would leak from the Gateway token balance the user purchased.
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'https://www.aiden.services'
const SERVICE_KEY = process.env.AIDEN_SERVICE_KEY

interface CheckResult {
  allowed: boolean
  required: number
  balance: number
}

interface DeductResult {
  success: boolean
  remaining?: number
  error?: string
  required?: number
  balance?: number
  transactionId?: string
  requestId?: string
  idempotent?: boolean
}

export interface CompensationResult {
  success: boolean
  noDeduction?: boolean
  newBalance?: number
  compensatedTokens?: number
  transactionId?: string
  idempotent?: boolean
  error?: string
}

function getHeaders(userId: string): Record<string, string> {
  if (!SERVICE_KEY) {
    throw new Error('AIDEN_SERVICE_KEY is not configured')
  }
  return {
    'Content-Type': 'application/json',
    'X-Service-Key': SERVICE_KEY,
    'X-User-Id': userId,
  }
}

export async function checkTokens(
  userId: string,
  product: string,
  operation: string
): Promise<CheckResult> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/tokens/check`, {
      method: 'POST',
      headers: getHeaders(userId),
      body: JSON.stringify({ product, operation }),
    })

    if (!res.ok) {
      console.error(`[gateway-tokens] Check failed: ${res.status}`)
      // Fail closed: don't grant access on Gateway error.
      return { allowed: false, required: 0, balance: 0 }
    }

    return res.json()
  } catch (err) {
    console.error('[gateway-tokens] Check threw:', err)
    // Fail closed: don't grant access on network failure.
    return { allowed: false, required: 0, balance: 0 }
  }
}

export async function deductTokens(
  userId: string,
  product: string,
  operation: string,
  requestId?: string,
): Promise<DeductResult> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/tokens/deduct`, {
      method: 'POST',
      headers: getHeaders(userId),
      body: JSON.stringify({ product, operation, requestId }),
    })

    if (!res.ok && res.status === 402) {
      return res.json()
    }

    if (!res.ok) {
      console.error(`[gateway-tokens] Deduct failed: ${res.status}`)
      // Fail closed: pretending the deduct succeeded silently leaks tokens.
      return { success: false, error: `gateway_error_${res.status}` }
    }

    return res.json()
  } catch (err) {
    console.error('[gateway-tokens] Deduct threw:', err)
    // Fail closed: don't silently succeed on network failure.
    return { success: false, error: 'gateway_unreachable' }
  }
}

export async function compensateTokens(
  userId: string,
  product: string,
  operation: string,
  requestId: string,
  transactionId?: string,
): Promise<CompensationResult> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/tokens/compensate`, {
      method: 'POST',
      headers: getHeaders(userId),
      body: JSON.stringify({
        userId,
        product,
        operation,
        requestId,
        transactionId,
        reason: 'async_job_failed',
      }),
    })

    // A 404 is not a durable promise that an ambiguous in-flight deduction
    // cannot commit later. The caller must first replay the idempotent
    // deduction request, then retry compensation against the converged row.
    if (res.status === 404) {
      return {
        success: false,
        noDeduction: true,
        error: 'deduction_not_found',
      }
    }
    if (!res.ok) {
      console.error(`[gateway-tokens] Compensation failed: ${res.status}`)
      return { success: false, error: `gateway_error_${res.status}` }
    }
    return res.json()
  } catch (err) {
    console.error('[gateway-tokens] Compensation threw:', err)
    return { success: false, error: 'gateway_unreachable' }
  }
}

export async function recordCostEvent(event: {
  userId: string
  requestId: string
  idempotencyKey: string
  providerTaskId?: string
  status: 'failed' | 'unallocated'
  computeSeconds: number
  metadata?: Record<string, unknown>
}): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/cost-events`, {
      method: 'POST',
      headers: getHeaders(event.userId),
      body: JSON.stringify({
        idempotencyKey: event.idempotencyKey,
        requestId: event.requestId,
        product: 'refraim',
        operation: 'video_export',
        provider: 'railway',
        providerAccountAlias: 'aiden-refraim',
        providerTaskId: event.providerTaskId,
        status: event.status,
        computeSeconds: event.computeSeconds,
        metadata: event.metadata,
      }),
    })
    if (!res.ok) {
      console.error(`[gateway-costs] Record failed: ${res.status}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[gateway-costs] Record threw:', err)
    return false
  }
}
