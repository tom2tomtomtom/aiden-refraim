import { authorizeAiSpend, settleAiSpend } from '../../lib/ai-metering';
import { checkTokens, deductTokens } from '../../lib/gateway-tokens';

jest.mock('../../lib/gateway-tokens', () => ({
  checkTokens: jest.fn(),
  deductTokens: jest.fn(),
}));

const mockCheck = checkTokens as jest.MockedFunction<typeof checkTokens>;
const mockDeduct = deductTokens as jest.MockedFunction<typeof deductTokens>;

describe('ai-metering', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('authorizeAiSpend', () => {
    it('does not consult Gateway when no provider key is configured', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.AIDEN_SERVICE_KEY = 'svc';

      const decision = await authorizeAiSpend('user-1', 'ai_focus_strategy');

      expect(decision).toEqual({ paid: false, reason: 'no_provider_key' });
      expect(mockCheck).not.toHaveBeenCalled();
    });

    it('refuses the paid path when the provider key is set but metering is not configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      delete process.env.AIDEN_SERVICE_KEY;

      const decision = await authorizeAiSpend('user-1', 'ai_focus_strategy');

      // Spending real provider credit with no way to bill it back is the one
      // outcome this gate exists to prevent.
      expect(decision).toEqual({ paid: false, reason: 'no_service_key' });
      expect(mockCheck).not.toHaveBeenCalled();
    });

    it('reports the shortfall when the balance is too low', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.AIDEN_SERVICE_KEY = 'svc';
      mockCheck.mockResolvedValue({ allowed: false, required: 3, balance: 1 });

      const decision = await authorizeAiSpend('user-1', 'ai_focus_strategy');

      expect(decision).toEqual({
        paid: false,
        reason: 'insufficient_tokens',
        required: 3,
        balance: 1,
      });
    });

    it('denies when Gateway is unreachable, because checkTokens fails closed', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.AIDEN_SERVICE_KEY = 'svc';
      mockCheck.mockResolvedValue({ allowed: false, required: 0, balance: 0 });

      const decision = await authorizeAiSpend('user-1', 'crop_review');

      expect(decision.paid).toBe(false);
    });

    it('issues a distinct request id per authorized call', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.AIDEN_SERVICE_KEY = 'svc';
      mockCheck.mockResolvedValue({ allowed: true, required: 3, balance: 50 });

      const first = await authorizeAiSpend('user-1', 'ai_focus_strategy');
      const second = await authorizeAiSpend('user-1', 'ai_focus_strategy');

      expect(first).toMatchObject({ paid: true });
      expect(second).toMatchObject({ paid: true });
      expect((first as any).requestId).not.toEqual((second as any).requestId);
      expect(mockCheck).toHaveBeenCalledWith('user-1', 'refraim', 'ai_focus_strategy');
    });

    it('names the operation it is charging for', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.AIDEN_SERVICE_KEY = 'svc';
      mockCheck.mockResolvedValue({ allowed: true, required: 2, balance: 50 });

      await authorizeAiSpend('user-9', 'crop_review');

      // refrAIm never sends a price: Gateway owns the cost of each operation.
      expect(mockCheck).toHaveBeenCalledWith('user-9', 'refraim', 'crop_review');
    });
  });

  describe('settleAiSpend', () => {
    it('passes the request id so a replayed settlement deducts once', async () => {
      mockDeduct.mockResolvedValue({ success: true, remaining: 47 });

      const settled = await settleAiSpend('user-1', 'ai_focus_strategy', 'req-abc');

      expect(settled).toBe(true);
      expect(mockDeduct).toHaveBeenCalledWith(
        'user-1',
        'refraim',
        'ai_focus_strategy',
        'req-abc',
      );
    });

    it('reports failure when the deduction does not land', async () => {
      mockDeduct.mockResolvedValue({ success: false, error: 'gateway_unreachable' });

      await expect(settleAiSpend('user-1', 'crop_review', 'req-abc')).resolves.toBe(false);
    });
  });
});
