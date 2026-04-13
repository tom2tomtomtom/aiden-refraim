import { PLANS } from '../../config/stripe';

describe('PLANS config', () => {
  it('has 4 entries (free, starter, pro, agency)', () => {
    const keys = Object.keys(PLANS);
    expect(keys).toEqual(['free', 'starter', 'pro', 'agency']);
    expect(keys).toHaveLength(4);
  });

  it('free plan has price 0 and no priceId', () => {
    expect(PLANS.free.price).toBe(0);
    expect(PLANS.free.priceId).toBeNull();
  });

  it('starter exports per month is 50', () => {
    expect(PLANS.starter.exportsPerMonth).toBe(50);
  });

  it('pro and agency have unlimited (-1) exports', () => {
    expect(PLANS.pro.exportsPerMonth).toBe(-1);
    expect(PLANS.agency.exportsPerMonth).toBe(-1);
  });
});
