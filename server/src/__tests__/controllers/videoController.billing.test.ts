import type { Request, Response } from 'express';

const mockProcessVideoForPlatforms = jest.fn();
const mockGetVideo = jest.fn();
const mockCreateProcessingJob = jest.fn();
const mockGetQuotaState = jest.fn();
const mockReserveExport = jest.fn();
const mockCheckTokens = jest.fn();
const mockDeductTokens = jest.fn();
const mockRecordCostEvent = jest.fn();

jest.mock('../../services/videoProcessingService', () => ({
  processVideoForPlatforms: (...args: unknown[]) => mockProcessVideoForPlatforms(...args),
}));

jest.mock('../../services/storageService', () => ({
  StorageService: {},
}));

jest.mock('../../services/databaseService', () => ({
  DatabaseService: {
    getVideo: (...args: unknown[]) => mockGetVideo(...args),
    createProcessingJob: (...args: unknown[]) => mockCreateProcessingJob(...args),
  },
}));

jest.mock('../../config/supabase', () => ({
  supabase: {},
}));

jest.mock('../../lib/quota', () => ({
  getQuotaState: (...args: unknown[]) => mockGetQuotaState(...args),
  reserveExport: (...args: unknown[]) => mockReserveExport(...args),
}));

jest.mock('../../lib/gateway-tokens', () => ({
  checkTokens: (...args: unknown[]) => mockCheckTokens(...args),
  deductTokens: (...args: unknown[]) => mockDeductTokens(...args),
  recordCostEvent: (...args: unknown[]) => mockRecordCostEvent(...args),
}));

import { processVideo } from '../../controllers/videoController';

function makeResponse(): Response {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  (response.status as jest.Mock).mockReturnValue(response);
  (response.json as jest.Mock).mockReturnValue(response);
  return response;
}

async function flushBackgroundWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('processVideo billing settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AIDEN_SERVICE_KEY = 'service-key';
    mockGetVideo.mockResolvedValue({
      id: 'video-1',
      user_id: 'user-1',
      original_url: 'original/video-1.mp4',
      status: 'UPLOADED',
      platforms: [],
    });
    mockCreateProcessingJob.mockResolvedValue({ id: 'job-1' });
    mockGetQuotaState.mockResolvedValue({
      plan: 'free',
      used: 3,
      limit: 3,
      remaining: 0,
    });
    mockCheckTokens.mockResolvedValue({ allowed: true, required: 2, balance: 20 });
    mockRecordCostEvent.mockResolvedValue(true);
    mockDeductTokens.mockResolvedValue({ success: true, remaining: 18 });
  });

  afterEach(() => {
    delete process.env.AIDEN_SERVICE_KEY;
  });

  it('settles a successful token charge before processing publishes terminal output', async () => {
    const order: string[] = [];
    mockDeductTokens.mockImplementation(async () => {
      order.push('deducted');
      return { success: true, remaining: 18 };
    });
    mockProcessVideoForPlatforms.mockImplementation(
      async (
        _video: unknown,
        _platforms: unknown,
        beforePublish: (outcome: { successfulOutputs: number; failedOutputs: number }) => Promise<void>,
      ) => {
        await beforePublish({ successfulOutputs: 1, failedOutputs: 0 });
        order.push('terminal-published');
        return { successfulOutputs: 1, failedOutputs: 0 };
      },
    );

    const request = {
      user: { id: 'user-1', email: 'user@example.com' },
      params: { id: 'video-1' },
      body: { platforms: ['instagram-story'] },
    } as unknown as Request;

    await processVideo(request, makeResponse());
    await flushBackgroundWork();

    expect(mockDeductTokens).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['deducted', 'terminal-published']);
  });

  it('does not charge when every requested output fails', async () => {
    mockProcessVideoForPlatforms.mockResolvedValue({
      successfulOutputs: 0,
      failedOutputs: 1,
    });

    const request = {
      user: { id: 'user-1', email: 'user@example.com' },
      params: { id: 'video-1' },
      body: { platforms: ['instagram-story'] },
    } as unknown as Request;

    await processVideo(request, makeResponse());
    await flushBackgroundWork();

    expect(mockDeductTokens).not.toHaveBeenCalled();
  });
});
