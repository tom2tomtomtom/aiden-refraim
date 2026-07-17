import { shouldChargeGatewayTokens } from '../../lib/billing-path';

describe('shouldChargeGatewayTokens', () => {
  it('charges Gateway tokens for free users when the service key is configured', () => {
    expect(shouldChargeGatewayTokens('free', true)).toBe(true);
  });

  it.each(['starter', 'pro', 'agency'])(
    'does not charge paid %s subscribers through Gateway',
    (plan) => {
      expect(shouldChargeGatewayTokens(plan, true)).toBe(false);
    },
  );

  it('does not charge Gateway tokens when the service key is absent', () => {
    expect(shouldChargeGatewayTokens('free', false)).toBe(false);
  });
});
