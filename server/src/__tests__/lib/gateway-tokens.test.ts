describe('Gateway cost linkage', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.AIDEN_SERVICE_KEY = 'test-key';
    process.env.GATEWAY_URL = 'https://test.aiden.services';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, remaining: 10 }),
    }) as jest.Mock;
  });

  afterEach(() => {
    delete process.env.AIDEN_SERVICE_KEY;
    delete process.env.GATEWAY_URL;
    jest.restoreAllMocks();
  });

  it('passes the export request UUID to the token deduction', async () => {
    const { deductTokens } = await import('../../lib/gateway-tokens');
    await deductTokens(
      'user-1',
      'refraim',
      'video_export',
      '11111111-1111-4111-8111-111111111111',
    );

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://test.aiden.services/api/tokens/deduct');
    expect(JSON.parse(options.body)).toEqual({
      product: 'refraim',
      operation: 'video_export',
      requestId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('records Railway processing units without inventing a dollar cost', async () => {
    const { recordCostEvent } = await import('../../lib/gateway-tokens');
    await recordCostEvent({
      userId: 'user-1',
      requestId: '22222222-2222-4222-8222-222222222222',
      idempotencyKey: 'railway:22222222-2222-4222-8222-222222222222',
      providerTaskId: 'job-1',
      status: 'unallocated',
      computeSeconds: 12.5,
      metadata: { reason: 'requires_allocation' },
    });

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://test.aiden.services/api/cost-events');
    expect(JSON.parse(options.body)).toMatchObject({
      product: 'refraim',
      operation: 'video_export',
      provider: 'railway',
      status: 'unallocated',
      computeSeconds: 12.5,
    });
    expect(JSON.parse(options.body).measuredCostUsd).toBeUndefined();
  });

  it('atomically compensates an async job deduction using its durable request id', async () => {
    const { compensateTokens } = await import('../../lib/gateway-tokens');
    await compensateTokens(
      'user-1',
      'refraim',
      'video_export',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    );

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://test.aiden.services/api/tokens/compensate');
    expect(JSON.parse(options.body)).toEqual({
      userId: 'user-1',
      product: 'refraim',
      operation: 'video_export',
      requestId: '33333333-3333-4333-8333-333333333333',
      transactionId: '44444444-4444-4444-8444-444444444444',
      reason: 'async_job_failed',
    });
  });

  it('keeps a missing deduction unresolved until the idempotent deduction is replayed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'compensable_deduction_not_found' }),
    }) as jest.Mock;
    const { compensateTokens } = await import('../../lib/gateway-tokens');

    await expect(compensateTokens(
      'user-1',
      'refraim',
      'video_export',
      '55555555-5555-4555-8555-555555555555',
    )).resolves.toMatchObject({
      success: false,
      noDeduction: true,
      error: 'deduction_not_found',
    });
  });
});
