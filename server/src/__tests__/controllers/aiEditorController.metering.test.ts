import { Request, Response } from 'express';
import { getAIFocusStrategy } from '../../controllers/aiEditorController';
import { generateFocusStrategy } from '../../services/aiEditorService';
import { authorizeAiSpend, settleAiSpend } from '../../lib/ai-metering';

jest.mock('../../services/aiEditorService', () => ({
  generateFocusStrategy: jest.fn(),
  reviewCrops: jest.fn(),
}));

jest.mock('../../lib/ai-metering', () => ({
  authorizeAiSpend: jest.fn(),
  settleAiSpend: jest.fn(),
}));

jest.mock('../../config/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'eq']) chain[m] = jest.fn().mockReturnValue(chain);
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'vid-1' }, error: null });
  return { supabase: { from: jest.fn().mockReturnValue(chain) } };
});

const mockGenerate = generateFocusStrategy as jest.MockedFunction<typeof generateFocusStrategy>;
const mockAuthorize = authorizeAiSpend as jest.MockedFunction<typeof authorizeAiSpend>;
const mockSettle = settleAiSpend as jest.MockedFunction<typeof settleAiSpend>;

const STRATEGY = { keyframes: [], reasoning: 'r' } as any;

function mockReq(): Request {
  return {
    params: { videoId: 'vid-1' },
    user: { id: 'user-1' },
    body: {
      subjects: [{ id: 's1', class: 'person' }],
      videoDuration: 12,
      targetPlatform: 'tiktok',
    },
  } as any;
}

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('aiEditorController metering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerate.mockResolvedValue(STRATEGY);
    mockSettle.mockResolvedValue(true);
  });

  it('refuses before calling the provider when the balance is short', async () => {
    mockAuthorize.mockResolvedValue({
      paid: false,
      reason: 'insufficient_tokens',
      required: 3,
      balance: 0,
    });
    const res = mockRes();

    await getAIFocusStrategy(mockReq(), res);

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Insufficient tokens', required: 3 }),
    );
  });

  it('deducts once for an authorized call and returns the strategy', async () => {
    mockAuthorize.mockResolvedValue({ paid: true, requestId: 'req-1' });
    const res = mockRes();

    await getAIFocusStrategy(mockReq(), res);

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.anything(),
      12,
      'tiktok',
      undefined,
      undefined,
      undefined,
      { allowPaidProvider: true },
    );
    expect(mockSettle).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledWith('user-1', 'ai_focus_strategy', 'req-1');
    expect(res.json).toHaveBeenCalledWith(STRATEGY);
  });

  it('withholds the result when the charge cannot be settled', async () => {
    mockAuthorize.mockResolvedValue({ paid: true, requestId: 'req-1' });
    mockSettle.mockResolvedValue(false);
    const res = mockRes();

    await getAIFocusStrategy(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).not.toHaveBeenCalledWith(STRATEGY);
  });

  it('serves the free fallback without settling when nothing paid ran', async () => {
    mockAuthorize.mockResolvedValue({ paid: false, reason: 'no_provider_key' });
    const res = mockRes();

    await getAIFocusStrategy(mockReq(), res);

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.anything(),
      12,
      'tiktok',
      undefined,
      undefined,
      undefined,
      { allowPaidProvider: false },
    );
    expect(mockSettle).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(STRATEGY);
  });
});
