/**
 * Gateway Token Client
 *
 * Calls the AIDEN Gateway token API for balance checks and deductions.
 * Uses X-Service-Key + X-User-Id headers for server-to-server auth.
 *
 * DELIBERATE fail-OPEN: refrAIm's primary billing is standalone Stripe
 * (free/starter/pro/agency plans). Gateway token deductions are a
 * secondary hook, only active when AIDEN_SERVICE_KEY is configured.
 * If Gateway is unreachable we do NOT block video export — the user has
 * already paid via their Stripe subscription. Unlike other hub apps
 * (Synthetic Research, Listen, Brand Audit, Brief Sharpener, Ads) which
 * MUST fail closed because Gateway IS their billing, refrAIm is hybrid.
 *
 * If refrAIm ever migrates to Gateway-primary billing, flip both returns
 * below to `{ allowed: false, gatewayUnavailable: true }` and
 * `{ success: false, error: 'gateway_unreachable' }` respectively.
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
      return { allowed: true, required: 0, balance: 0 }
    }

    return res.json()
  } catch (err) {
    // See file header: refrAIm bills via Stripe, Gateway is secondary.
    console.error('[gateway-tokens] Check threw:', err)
    return { allowed: true, required: 0, balance: 0 }
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
      return { success: true, remaining: 0 }
    }

    return res.json()
  } catch (err) {
    console.error('[gateway-tokens] Deduct threw:', err)
    return { success: true, remaining: 0 }
  }
}
