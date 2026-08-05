const mockGetVideo = jest.fn();
const mockGetProcessingJob = jest.fn();
const mockGetLatestProcessingJob = jest.fn();
const mockUpdateProcessingJob = jest.fn();
const mockTransitionProcessingJob = jest.fn();
const mockReleaseVideoProcessing = jest.fn();
const mockFenceVideoPublication = jest.fn();
const mockRecoverPlanQuotaExport = jest.fn();
const mockDeductTokens = jest.fn();
const mockCompensateTokens = jest.fn();
const mockRpc = jest.fn();

jest.mock('../../services/databaseService', () => ({
  DatabaseService: {
    getVideo: (...args: unknown[]) => mockGetVideo(...args),
    getProcessingJob: (...args: unknown[]) => mockGetProcessingJob(...args),
    getLatestProcessingJob: (...args: unknown[]) => mockGetLatestProcessingJob(...args),
    updateProcessingJob: (...args: unknown[]) => mockUpdateProcessingJob(...args),
    transitionProcessingJob: (...args: unknown[]) => mockTransitionProcessingJob(...args),
    releaseVideoProcessing: (...args: unknown[]) => mockReleaseVideoProcessing(...args),
    fenceVideoPublication: (...args: unknown[]) => mockFenceVideoPublication(...args),
  },
}));

jest.mock('../../config/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('../../lib/quota', () => ({
  recoverPlanQuotaExport: (...args: unknown[]) => mockRecoverPlanQuotaExport(...args),
}));

jest.mock('../../lib/gateway-tokens', () => ({
  deductTokens: (...args: unknown[]) => mockDeductTokens(...args),
  compensateTokens: (...args: unknown[]) => mockCompensateTokens(...args),
}));

import { sweepStaleExports } from '../../lib/exportReaper';
import { listStaleExports } from '../../lib/exportLease';
import { isStaleNonSettlementJob } from '../../lib/exportRecovery';

const JOB_ID = '44444444-4444-4444-8444-444444444444';
const VIDEO_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';
const LONG_AGO = new Date(Date.now() - 6 * 60 * 60_000).toISOString();

describe('export lease staleness', () => {
  it('treats a live lease as authoritative over an old progress timestamp', () => {
    // The render that produced this job has written no progress for six hours,
    // which the previous rule would have called dead. It is heartbeating.
    expect(isStaleNonSettlementJob({
      status: 'processing_gateway_tokens',
      updated_at: LONG_AGO,
      created_at: LONG_AGO,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    })).toBe(false);
  });

  it('treats a lapsed lease as stale even when progress moved recently', () => {
    expect(isStaleNonSettlementJob({
      status: 'processing_gateway_tokens',
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() - 1_000).toISOString(),
    })).toBe(true);
  });

  it('falls back to the previous rule for jobs that predate the lease column', () => {
    expect(isStaleNonSettlementJob({
      status: 'processing_gateway_tokens',
      updated_at: LONG_AGO,
      created_at: LONG_AGO,
    })).toBe(true);
    expect(isStaleNonSettlementJob({
      status: 'processing_gateway_tokens',
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })).toBe(false);
  });
});

describe('listStaleExports', () => {
  it('maps the sweep RPC rows onto the reaper shape', async () => {
    mockRpc.mockResolvedValue({
      data: [{ job_id: JOB_ID, video_id: VIDEO_ID, user_id: USER_ID }],
      error: null,
    });

    await expect(listStaleExports(10)).resolves.toEqual([
      { jobId: JOB_ID, videoId: VIDEO_ID, userId: USER_ID },
    ]);
    expect(mockRpc).toHaveBeenCalledWith(
      'list_stale_refraim_exports',
      expect.objectContaining({ p_limit: 10 }),
    );
  });
});

describe('sweepStaleExports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({
      data: [{ job_id: JOB_ID, video_id: VIDEO_ID, user_id: USER_ID }],
      error: null,
    });
    mockGetVideo.mockResolvedValue({
      id: VIDEO_ID,
      user_id: USER_ID,
      status: 'processing',
      processing_metadata: { active_job_id: JOB_ID, publication_state: 'active' },
    });
    mockGetProcessingJob.mockResolvedValue({
      id: JOB_ID,
      status: 'processing_gateway_tokens',
      updated_at: LONG_AGO,
      created_at: LONG_AGO,
      lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    mockTransitionProcessingJob.mockImplementation(async (id, _expected, update) => ({
      id,
      ...update,
    }));
    mockUpdateProcessingJob.mockImplementation(async (_id, update) => update);
    mockReleaseVideoProcessing.mockResolvedValue(true);
  });

  it('fails and releases an export whose lease lapsed, with no client poll', async () => {
    await expect(sweepStaleExports(5)).resolves.toBe(1);

    expect(mockReleaseVideoProcessing).toHaveBeenCalledWith(
      VIDEO_ID,
      USER_ID,
      JOB_ID,
      expect.objectContaining({ status: 'failed', platform_outputs: null }),
    );
    expect(mockUpdateProcessingJob).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: 'failed', progress: 100 }),
    );
  });

  it('leaves a heartbeating render completely alone', async () => {
    mockGetProcessingJob.mockResolvedValue({
      id: JOB_ID,
      status: 'processing_gateway_tokens',
      updated_at: LONG_AGO,
      created_at: LONG_AGO,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    await sweepStaleExports(5);

    expect(mockReleaseVideoProcessing).not.toHaveBeenCalled();
    expect(mockTransitionProcessingJob).not.toHaveBeenCalled();
  });

  it('skips a row whose video no longer belongs to the recorded owner', async () => {
    mockGetVideo.mockResolvedValue({
      id: VIDEO_ID,
      user_id: 'someone-else',
      status: 'processing',
    });

    await expect(sweepStaleExports(5)).resolves.toBe(0);
    expect(mockReleaseVideoProcessing).not.toHaveBeenCalled();
  });

  it('keeps sweeping the batch after one row throws', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { job_id: JOB_ID, video_id: 'bad-video', user_id: USER_ID },
        { job_id: JOB_ID, video_id: VIDEO_ID, user_id: USER_ID },
      ],
      error: null,
    });
    mockGetVideo.mockImplementation(async (videoId: string) => {
      if (videoId === 'bad-video') throw new Error('row read failed');
      return {
        id: VIDEO_ID,
        user_id: USER_ID,
        status: 'processing',
        processing_metadata: { active_job_id: JOB_ID, publication_state: 'active' },
      };
    });

    await expect(sweepStaleExports(5)).resolves.toBe(1);
  });
});
