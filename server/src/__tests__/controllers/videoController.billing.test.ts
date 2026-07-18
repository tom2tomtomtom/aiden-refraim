import type { Request, Response } from 'express';

const mockProcessVideoForPlatforms = jest.fn();
const mockGetVideo = jest.fn();
const mockCreateProcessingJob = jest.fn();
const mockClaimVideoForProcessing = jest.fn();
const mockGetLatestProcessingJob = jest.fn();
const mockGetProcessingJob = jest.fn();
const mockUpdateProcessingJob = jest.fn();
const mockTransitionProcessingJob = jest.fn();
const mockDeleteProcessingJob = jest.fn();
const mockUpdateVideo = jest.fn();
const mockReleaseVideoProcessing = jest.fn();
const mockFenceVideoPublication = jest.fn();
const mockGetQuotaState = jest.fn();
const mockReserveExport = jest.fn();
const mockCheckTokens = jest.fn();
const mockDeductTokens = jest.fn();
const mockCompensateTokens = jest.fn();
const mockRecordCostEvent = jest.fn();
const mockSignVideoRecord = jest.fn();
const mockGetSignedUrl = jest.fn();
const mockDeleteStoredVideo = jest.fn();
const mockDeleteVideoIfIdle = jest.fn();
const JOB_ID = '33333333-3333-4333-8333-333333333333';

jest.mock('node:crypto', () => ({ randomUUID: () => JOB_ID }));

jest.mock('../../services/videoProcessingService', () => ({
  processVideoForPlatforms: (...args: unknown[]) => mockProcessVideoForPlatforms(...args),
}));

jest.mock('../../services/storageService', () => ({
  StorageService: {
    signVideoRecord: (...args: unknown[]) => mockSignVideoRecord(...args),
    getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
    deleteVideo: (...args: unknown[]) => mockDeleteStoredVideo(...args),
  },
}));

jest.mock('../../services/databaseService', () => ({
  DatabaseService: {
    getVideo: (...args: unknown[]) => mockGetVideo(...args),
    createProcessingJob: (...args: unknown[]) => mockCreateProcessingJob(...args),
    claimVideoForProcessing: (...args: unknown[]) => mockClaimVideoForProcessing(...args),
    getLatestProcessingJob: (...args: unknown[]) => mockGetLatestProcessingJob(...args),
    getProcessingJob: (...args: unknown[]) => mockGetProcessingJob(...args),
    updateProcessingJob: (...args: unknown[]) => mockUpdateProcessingJob(...args),
    transitionProcessingJob: (...args: unknown[]) => mockTransitionProcessingJob(...args),
    deleteProcessingJob: (...args: unknown[]) => mockDeleteProcessingJob(...args),
    updateVideo: (...args: unknown[]) => mockUpdateVideo(...args),
    releaseVideoProcessing: (...args: unknown[]) => mockReleaseVideoProcessing(...args),
    fenceVideoPublication: (...args: unknown[]) => mockFenceVideoPublication(...args),
    deleteVideoIfIdle: (...args: unknown[]) => mockDeleteVideoIfIdle(...args),
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

import { deleteVideo, getVideoStatus, processVideo } from '../../controllers/videoController';

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
    mockGetProcessingJob.mockResolvedValue(null);
    mockCreateProcessingJob.mockImplementation(async (job) => job);
    mockDeleteProcessingJob.mockResolvedValue(undefined);
    mockUpdateProcessingJob.mockImplementation(async (_id, update) => update);
    mockTransitionProcessingJob.mockImplementation(async (id, _expected, update) => ({
      id,
      ...update,
    }));
    mockUpdateVideo.mockResolvedValue({ id: 'video-1' });
    mockReleaseVideoProcessing.mockResolvedValue(true);
    mockFenceVideoPublication.mockResolvedValue(true);
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
    mockDeleteStoredVideo.mockResolvedValue(undefined);
    mockDeleteVideoIfIdle.mockResolvedValue(true);
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
    expect(mockCreateProcessingJob).toHaveBeenCalledTimes(1);
    expect(mockDeleteProcessingJob).toHaveBeenCalledTimes(1);
    expect(mockProcessVideoForPlatforms).not.toHaveBeenCalled();
  });

  it('durably creates the job before claiming the video or reserving allowance', async () => {
    const order: string[] = [];
    mockGetQuotaState.mockResolvedValue({
      plan: 'free', used: 0, limit: 3, remaining: 3,
    });
    mockCreateProcessingJob.mockImplementation(async (job) => {
      order.push('job');
      return job;
    });
    mockClaimVideoForProcessing.mockImplementation(async () => {
      order.push('claim');
      return true;
    });
    mockReserveExport.mockImplementation(async () => {
      order.push('reserve');
      return { plan: 'free', used: 1, limit: 3, remaining: 2 };
    });
    mockProcessVideoForPlatforms.mockResolvedValue({
      successfulOutputs: 0, failedOutputs: 1,
    });

    await processVideo({
      user: { id: 'user-1' },
      params: { id: 'video-1' },
      body: { platforms: ['instagram-story'] },
    } as unknown as Request, makeResponse());

    expect(order.slice(0, 3)).toEqual(['job', 'claim', 'reserve']);
  });

  it('does not claim or consume allowance when durable job creation fails', async () => {
    mockGetQuotaState.mockResolvedValue({
      plan: 'free', used: 0, limit: 3, remaining: 3,
    });
    mockCreateProcessingJob.mockRejectedValue(new Error('job insert failed'));
    const response = makeResponse();

    await processVideo({
      user: { id: 'user-1' },
      params: { id: 'video-1' },
      body: { platforms: ['instagram-story'] },
    } as unknown as Request, response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(mockClaimVideoForProcessing).not.toHaveBeenCalled();
    expect(mockReserveExport).not.toHaveBeenCalled();
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
      expect.objectContaining({ status: 'failed_compensated' }),
    );
  });

  it('does not compensate when publication wins the video-row fence race', async () => {
    mockGetVideo
      .mockResolvedValueOnce({
        id: 'video-1',
        user_id: 'user-1',
        original_url: 'original/video-1.mp4',
        status: 'UPLOADED',
        platforms: [],
      })
      .mockResolvedValueOnce({
        id: 'video-1',
        user_id: 'user-1',
        status: 'processing',
        platform_outputs: null,
      })
      .mockResolvedValueOnce({
        id: 'video-1',
        user_id: 'user-1',
        status: 'completed',
        platform_outputs: {
          'instagram-story': { status: 'complete', url: 'processed/story.mp4' },
        },
      });
    mockFenceVideoPublication.mockResolvedValue(false);
    mockProcessVideoForPlatforms.mockImplementation(async (_video, _platforms, context) => {
      await context.beforePublish({ successfulOutputs: 1, failedOutputs: 0 });
      throw new Error('worker observed a transient publication response');
    });

    await processVideo({
      user: { id: 'user-1' },
      params: { id: 'video-1' },
      body: { platforms: ['instagram-story'] },
    } as unknown as Request, makeResponse());
    await flushBackgroundWork();

    expect(mockDeductTokens).toHaveBeenCalledTimes(1);
    expect(mockCompensateTokens).not.toHaveBeenCalled();
    expect(mockUpdateProcessingJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: 'completed' }),
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

    expect(mockFenceVideoPublication).toHaveBeenCalledWith(
      'video-1', 'user-1', JOB_ID,
    );
    expect(mockFenceVideoPublication.mock.invocationCallOrder[0])
      .toBeLessThan(mockCompensateTokens.mock.invocationCallOrder[0]);
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

  it('finishes compensation recovery when a crash happened after releasing the video', async () => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1',
      user_id: 'user-1',
      status: 'failed',
      platform_outputs: null,
      processing_metadata: null,
    });
    mockGetLatestProcessingJob.mockResolvedValue({
      id: JOB_ID,
      video_id: 'video-1',
      user_id: 'user-1',
      status: 'compensation_pending_gateway_tokens',
      progress: 99,
      updated_at: '2026-07-18T00:00:00.000Z',
      created_at: '2026-07-18T00:00:00.000Z',
    });
    mockFenceVideoPublication.mockResolvedValue(false);
    const response = makeResponse();

    await getVideoStatus({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(mockCompensateTokens).toHaveBeenCalledWith(
      'user-1', 'refraim', 'video_export', JOB_ID,
    );
    expect(mockUpdateProcessingJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: 'failed_compensated' }),
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', balanceChanged: true, jobId: JOB_ID,
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

  it.each([
    'processing_gateway_tokens',
    'processing_plan_quota',
    'publishing_plan_quota',
    'publishing_no_charge',
    'PENDING',
    'RUNNING',
    'processing',
  ])('fails and releases a stale non-settlement phase %s without charging', async (status) => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1',
      user_id: 'user-1',
      status: 'processing',
      platform_outputs: null,
      processing_metadata: { active_job_id: JOB_ID, publication_state: 'active' },
    });
    const staleJob = {
      id: JOB_ID,
      video_id: 'video-1',
      user_id: 'user-1',
      status,
      progress: 40,
      updated_at: '2026-07-17T00:00:00.000Z',
      created_at: '2026-07-17T00:00:00.000Z',
    };
    mockGetProcessingJob.mockResolvedValue(staleJob);
    mockGetLatestProcessingJob.mockResolvedValue(staleJob);
    const response = makeResponse();

    await getVideoStatus({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(mockDeductTokens).not.toHaveBeenCalled();
    expect(mockCompensateTokens).not.toHaveBeenCalled();
    expect(mockReleaseVideoProcessing).toHaveBeenCalledWith(
      'video-1', 'user-1', JOB_ID, expect.objectContaining({ status: 'failed' }),
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', jobId: JOB_ID,
    }));
  });

  it('fails a stale durable job that crashed before it claimed the video', async () => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1',
      user_id: 'user-1',
      status: 'UPLOADED',
      platform_outputs: null,
      processing_metadata: null,
    });
    mockGetLatestProcessingJob.mockResolvedValue({
      id: JOB_ID,
      video_id: 'video-1',
      user_id: 'user-1',
      status: 'processing_plan_quota',
      progress: 0,
      updated_at: '2026-07-17T00:00:00.000Z',
      created_at: '2026-07-17T00:00:00.000Z',
    });
    const response = makeResponse();

    await getVideoStatus({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(mockReleaseVideoProcessing).not.toHaveBeenCalled();
    expect(mockUpdateProcessingJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', jobId: JOB_ID,
    }));
  });

  it('releases a stale processing claim whose durable job is missing', async () => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1',
      user_id: 'user-1',
      status: 'processing',
      updated_at: '2026-07-17T00:00:00.000Z',
      platform_outputs: null,
      processing_metadata: { active_job_id: JOB_ID, publication_state: 'active' },
    });
    mockGetProcessingJob.mockResolvedValue(null);
    mockGetLatestProcessingJob.mockResolvedValue(null);
    const response = makeResponse();

    await getVideoStatus({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(mockGetProcessingJob).toHaveBeenCalledWith(JOB_ID);
    expect(mockReleaseVideoProcessing).toHaveBeenCalledWith(
      'video-1', 'user-1', JOB_ID, expect.objectContaining({ status: 'failed' }),
    );
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', jobId: JOB_ID,
    }));
  });

  it('refuses deletion while the video has a nonterminal billing job', async () => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1',
      user_id: 'user-1',
      original_url: 'original/video-1.mp4',
      status: 'processing',
      processing_metadata: { active_job_id: JOB_ID },
      platform_outputs: null,
    });
    mockGetLatestProcessingJob.mockResolvedValue({
      id: JOB_ID,
      status: 'publishing_gateway_tokens',
      progress: 98,
    });
    const response = makeResponse();

    await deleteVideo({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringMatching(/processing|restoring/i),
      retryable: true,
    }));
    expect(mockDeleteVideoIfIdle).not.toHaveBeenCalled();
    expect(mockDeleteStoredVideo).not.toHaveBeenCalled();
  });

  it('returns a conflict when processing wins the final database delete race', async () => {
    mockGetVideo.mockResolvedValue({
      id: 'video-1',
      user_id: 'user-1',
      original_url: 'original/video-1.mp4',
      status: 'UPLOADED',
      processing_metadata: null,
      platform_outputs: null,
    });
    mockGetLatestProcessingJob.mockResolvedValue({
      id: 'old-job', status: 'completed', progress: 100,
    });
    mockDeleteVideoIfIdle.mockResolvedValue(false);
    const response = makeResponse();

    await deleteVideo({
      user: { id: 'user-1' }, params: { id: 'video-1' },
    } as unknown as Request, response);

    expect(mockDeleteVideoIfIdle).toHaveBeenCalledWith('video-1', 'user-1');
    expect(response.status).toHaveBeenCalledWith(409);
    expect(mockDeleteStoredVideo).not.toHaveBeenCalled();
  });
});
