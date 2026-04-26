/**
 * Gateway Token Client
 *
 * Calls the AIDEN Gateway token API for balance checks and deductions.
 * Uses X-Service-Key + X-User-Id headers for server-to-server auth.
 *
 * Fail-closed: if Gateway is unreachable, both checkTokens and deductTokens
 * deny the operation. Gateway token deductions are an optional secondary pool
 * on top of standalone Stripe billing (AIDEN_SERVICE_KEY must be set for them
 * to fire). Even as a secondary pool, silently skipping deductions on outage
 * leaks from the Gateway token balance users have purchased. Stripe plan quota
 * is a separate guard in videoController.ts and is unaffected by this.
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
  operation: string
): Promise<DeductResult> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/tokens/deduct`, {
      method: 'POST',
      headers: getHeaders(userId),
      body: JSON.stringify({ product, operation }),
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
