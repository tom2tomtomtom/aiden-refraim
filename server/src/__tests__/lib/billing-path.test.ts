import { resolveBillingPath } from '../../lib/billing-path';

/**
 * UXA-20260717 F-010 regression contract: exactly ONE entitlement path per
 * export. The audit reproduced a free-tier export consuming BOTH the free
 * monthly allowance (3→2) AND 2 Gateway tokens. These tests would have
 * failed before the fix.
 */
describe('resolveBillingPath', () => {
  it('F-010: a free user with allowance remaining pays with the allowance, NOT tokens', () => {
    expect(resolveBillingPath('free', 3, true)).toBe('plan_quota');
    expect(resolveBillingPath('free', 1, true)).toBe('plan_quota');
  });

  it('a free user with the allowance exhausted falls back to Gateway tokens', () => {
    expect(resolveBillingPath('free', 0, true)).toBe('gateway_tokens');
  });

  it('a free user with no allowance and no service key is blocked', () => {
    expect(resolveBillingPath('free', 0, false)).toBe('blocked');
  });

  it.each(['starter', 'pro', 'agency'])(
    'paid %s subscribers always use plan quota while it lasts',
    (plan) => {
      expect(resolveBillingPath(plan, 10, true)).toBe('plan_quota');
      expect(resolveBillingPath(plan, Number.POSITIVE_INFINITY, true)).toBe('plan_quota');
    },
  );

  it.each(['starter', 'pro', 'agency'])(
    'paid %s subscribers never silently fall back to Gateway tokens',
    (plan) => {
      expect(resolveBillingPath(plan, 0, true)).toBe('blocked');
    },
  );
});
