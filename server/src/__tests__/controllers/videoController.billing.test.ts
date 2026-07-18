import type { Request, Response } from 'express';

const mockProcessVideoForPlatforms = jest.fn();
const mockGetVideo = jest.fn();
const mockCreateProcessingJob = jest.fn();
const mockClaimVideoForProcessing = jest.fn();
const mockGetLatestProcessingJob = jest.fn();
const mockUpdateProcessingJob = jest.fn();
const mockTransitionProcessingJob = jest.fn();
const mockUpdateVideo = jest.fn();
const mockReleaseVideoProcessing = jest.fn();
const mockGetQuotaState = jest.fn();
const mockReserveExport = jest.fn();
const mockCheckTokens = jest.fn();
const mockDeductTokens = jest.fn();
const mockCompensateTokens = jest.fn();
const mockRecordCostEvent = jest.fn();
const mockSignVideoRecord = jest.fn();
const mockGetSignedUrl = jest.fn();
const JOB_ID = '33333333-3333-4333-8333-333333333333';

jest.mock('node:crypto', () => ({ randomUUID: () => JOB_ID }));

jest.mock('../../services/videoProcessingService', () => ({
  processVideoForPlatforms: (...args: unknown[]) => mockProcessVideoForPlatforms(...args),
}));

jest.mock('../../services/storageService', () => ({
  StorageService: {
    signVideoRecord: (...args: unknown[]) => mockSignVideoRecord(...args),
    getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
  },
}));

jest.mock('../../services/databaseService', () => ({
  DatabaseService: {
    getVideo: (...args: unknown[]) => mockGetVideo(...args),
    createProcessingJob: (...args: unknown[]) => mockCreateProcessingJob(...args),
    claimVideoForProcessing: (...args: unknown[]) => mockClaimVideoForProcessing(...args),
    getLatestProcessingJob: (...args: unknown[]) => mockGetLatestProcessingJob(...args),
    updateProcessingJob: (...args: unknown[]) => mockUpdateProcessingJob(...args),
    transitionProcessingJob: (...args: unknown[]) => mockTransitionProcessingJob(...args),
    updateVideo: (...args: unknown[]) => mockUpdateVideo(...args),
    releaseVideoProcessing: (...args: unknown[]) => mockReleaseVideoProcessing(...args),
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
  compensateTokens: (...args: unknown[]) => mockCompensateTokens(...args),
  recordCostEvent: (...args: unknown[]) => mockRecordCostEvent(...args),
}));

import { getVideoStatus, processVideo } from '../../controllers/videoController';

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
    mockClaimVideoForProcessing.mockResolvedValue(true);
    mockGetLatestProcessingJob.mockResolvedValue(null);
    mockCreateProcessingJob.mockImplementation(async (job) => job);
    mockUpdateProcessingJob.mockImplementation(async (_id, update) => update);
    mockTransitionProcessingJob.mockImplementation(async (id, _expected, update) => ({
      id,
      ...update,
    }));
    mockUpdateVideo.mockResolvedValue({ id: 'video-1' });
    mockReleaseVideoProcessing.mockResolvedValue(true);
    mockGetQuotaState.mockResolvedValue({
      plan: 'free',
      used: 3,
      limit: 3,
      remaining: 0,
    });
    mockCheckTokens.mockResolvedValue({ allowed: true, required: 2, balance: 20 });
    mockRecordCostEvent.mockResolvedValue(true);
    mockDeductTokens.mockResolvedValue({ success: true, remaining: 18 });
    mockCompensateTokens.mockResolvedValue({ success: true, newBalance: 20 });
    mockSignVideoRecord.mockImplementation(async (value) => value);
    mockGetSignedUrl.mockImplementation(async (value) => value);
  });

  afterEach(() => {
    delete process.env.AIDEN_SERVICE_KEY;
  });

  it('settles a successful token charge before processing publishes terminal output', async () => {
    const order: string[] = [];
    mockTransitionProcessingJob.mockImplementation(async (id, _expected, update) => {
      if (update.status === 'settling_gateway_tokens') order.push('settling');
      if (update.status === 'publishing_gateway_tokens') order.push('publishing');
      return { id, ...update };
    });
    mockDeductTokens.mockImplementation(async () => {
      order.push('deducted');
      return { success: true, remaining: 18 };
    });
    mockProcessVideoForPlatforms.mockImplementation(
      async (
        _video: unknown,
        _platforms: unknown,
        context: {
          jobId: string;
          beforePublish: (outcome: { successfulOutputs: number; failedOutputs: number }) => Promise<void>;
        },
      ) => {
        expect(context.jobId).toBe(JOB_ID);
        await context.beforePublish({ successfulOutputs: 1, failedOutputs: 0 });
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
    expect(mockDeductTokens).toHaveBeenCalledWith(
      'user-1', 'refraim', 'video_export', JOB_ID,
    );
    expect(order).toEqual([
      'settling',
      'deducted',
      'publishing',
      'terminal-published',
    ]);
    expect(mockCreateProcessingJob).toHaveBeenCalledWith(expect.objectContaining({
      id: JOB_ID,
    }));
    expect(mockClaimVideoForProcessing).toHaveBeenCalledWith(
      'video-1', 'user-1', JOB_ID,
    );
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

  it('returns the active job on a concurrent reload without reserving or starting again', async () => {
    mockClaimVideoForProcessing.mockResolvedValue(false);
    mockGetLatestProcessingJob.mockResolvedValue({
      id: 'active-job',
      status: 'processing',
      progress: 40,
    });
    const response = makeResponse();

    await processVideo({
      user: { id: 'user-1' },
      params: { id: 'video-1' },
      body: { platforms: ['instagram-story'] },
    } as unknown as Request, response);

    expect(response.status).toHaveBeenCalledWith(202);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      id: 'active-job',
      active: true,
    }));
    expect(mockReserveExport).not.toHaveBeenCalled();
    expect(mockCreateProcessingJob).not.toHaveBeenCalled();
    expect(mockProcessVideoForPlatforms).not.toHaveBeenCalled();
  });

  it('compensates a successful deduction when output publication fails', async () => {
    mockProcessVideoForPlatforms.mockImplementation(async (_video, _platforms, context) => {
      await context.beforePublish({ successfulOutputs: 1, failedOutputs: 0 });
      throw new Error('output publication failed');
    });

    await processVideo({
      user: { id: 'user-1' },
      params: { id: 'video-1' },
      body: { platforms: ['instagram-story'] },
    } as unknown as Request, makeResponse());
    await flushBackgroundWork();

    expect(mockUpdateProcessingJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: 'compensation_pending_gateway_tokens' }),
    );
    expect(mockCompensateTokens).toHaveBeenCalledWith(
      'user-1',
      'refraim',
      'video_export',
      JOB_ID,
    );
    expect(mockReleaseVideoProcessing).toHaveBeenCalledWith(
      'video-1', 'user-1', JOB_ID, expect.objectContaining({
        status: 'failed', platform_outputs: null,
      }),
    );
    expect(mockUpdateProcessingJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('fails a pre-settlement processing error without creating a deduction to compensate', async () => {
    mockProcessVideoForPlatforms.mockRejectedValue(new Error('analysis failed'));

    await processVideo({
      user: { id: 'user-1' },
      params: { id: 'video-1' },
      body: { platforms: ['instagram-story'] },
    } as unknown as Request, makeResponse());
    await flushBackgroundWork();

    expect(mockDeductTokens).not.toHaveBeenCalled();
    expect(mockCompensateTokens).not.toHaveBeenCalled();
    expect(mockReleaseVideoProcessing).toHaveBeenCalledWith(
      'video-1', 'user-1', JOB_ID, expect.objectContaining({
        status: 'failed', platform_outputs: null,
      }),
    );
  });

  it('recovers a stale ambiguous settlement by compensating before returning failure', async () => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1', user_id: 'user-1', status: 'processing', platform_outputs: null,
    });
    mockGetLatestProcessingJob.mockResolvedValue({
      id: JOB_ID,
      video_id: 'video-1',
      user_id: 'user-1',
      status: 'publishing_gateway_tokens',
      progress: 98,
      updated_at: '2026-07-18T00:00:00.000Z',
      created_at: '2026-07-18T00:00:00.000Z',
    });
    const response = makeResponse();

    await getVideoStatus({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(mockCompensateTokens).toHaveBeenCalledWith(
      'user-1', 'refraim', 'video_export', JOB_ID,
    );
    expect(mockDeductTokens).toHaveBeenCalledWith(
      'user-1', 'refraim', 'video_export', JOB_ID,
    );
    expect(mockReleaseVideoProcessing).toHaveBeenCalledWith(
      'video-1', 'user-1', JOB_ID, expect.objectContaining({
        status: 'failed', platform_outputs: null,
      }),
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      error: expect.stringMatching(/not complete|not charged/i),
      jobId: JOB_ID,
    }));
  });

  it('returns a live job for reload recovery without compensating or exposing old output', async () => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1', user_id: 'user-1', status: 'processing', platform_outputs: null,
    });
    mockGetLatestProcessingJob.mockResolvedValue({
      id: JOB_ID,
      status: 'processing_gateway_tokens',
      progress: 40,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    const response = makeResponse();

    await getVideoStatus({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(mockCompensateTokens).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'processing', progress: 40, platforms: {}, jobId: JOB_ID,
    }));
  });

  it('keeps a failed compensation locked and tells the user reconciliation is pending', async () => {
    mockCompensateTokens.mockResolvedValue({ success: false, error: 'gateway_unreachable' });
    mockGetVideo.mockResolvedValue({
      id: 'video-1', user_id: 'user-1', status: 'processing', platform_outputs: null,
    });
    mockGetLatestProcessingJob.mockResolvedValue({
      id: JOB_ID,
      status: 'compensation_pending_gateway_tokens',
      progress: 99,
      updated_at: '2026-07-18T00:00:00.000Z',
      created_at: '2026-07-18T00:00:00.000Z',
    });
    const response = makeResponse();

    await getVideoStatus({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(mockReleaseVideoProcessing).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'processing', reconciling: true,
      error: expect.stringMatching(/restoring|reconcil/i),
    }));
  });

  it('does not run a second reconciliation when another poll owns recovery', async () => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1', user_id: 'user-1', status: 'processing', platform_outputs: null,
    });
    mockGetLatestProcessingJob
      .mockResolvedValueOnce({
        id: JOB_ID,
        status: 'publishing_gateway_tokens',
        progress: 98,
        updated_at: '2026-07-18T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: JOB_ID,
        status: 'reconciling_gateway_tokens:other-poll',
        progress: 99,
        error: 'We are restoring your token balance. Please wait before retrying.',
      });
    mockTransitionProcessingJob.mockResolvedValue(null);

    await getVideoStatus({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, makeResponse());

    expect(mockDeductTokens).not.toHaveBeenCalled();
    expect(mockCompensateTokens).not.toHaveBeenCalled();
  });
});
